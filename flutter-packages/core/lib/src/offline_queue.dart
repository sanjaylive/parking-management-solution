import 'dart:convert';
import 'dart:math';
import 'package:cryptography/cryptography.dart';
import 'package:uuid/uuid.dart';
import 'api_client.dart';
import 'storage.dart';

/// A gate event captured while the API was unreachable.
class OfflineEvent {
  OfflineEvent({required this.localId, required this.type, required this.occurredAt, required this.facilityId, required this.data});
  final String localId;
  final String type; // ENTRY | EXIT
  final DateTime occurredAt;
  final String facilityId;
  final Map<String, dynamic> data;

  Map<String, dynamic> toPayload() => {'type': type, 'localId': localId, 'occurredAt': occurredAt.toUtc().toIso8601String(), ...data};
  Map<String, dynamic> toJson() => {'localId': localId, 'type': type, 'occurredAt': occurredAt.toUtc().toIso8601String(), 'facilityId': facilityId, 'data': data};
  static OfflineEvent fromJson(Map<String, dynamic> j) =>
      OfflineEvent(localId: j['localId'], type: j['type'], occurredAt: DateTime.parse(j['occurredAt']), facilityId: j['facilityId'], data: (j['data'] as Map).cast<String, dynamic>());
}

/// An event the server could not apply cleanly (conflict, rejected, needs review).
class AttentionItem {
  AttentionItem({required this.event, required this.status, required this.code, required this.message});
  final OfflineEvent event;
  final String status, code, message;
  Map<String, dynamic> toJson() => {'event': event.toJson(), 'status': status, 'code': code, 'message': message};
  static AttentionItem fromJson(Map<String, dynamic> j) =>
      AttentionItem(event: OfflineEvent.fromJson((j['event'] as Map).cast<String, dynamic>()), status: j['status'], code: j['code'], message: j['message']);
}

class OfflineLimitReached implements Exception {
  OfflineLimitReached(this.limit);
  final int limit;
  @override
  String toString() => 'Offline entry limit of $limit reached — admit vehicles only with supervisor approval.';
}

class SyncReport {
  SyncReport({required this.accepted, required this.duplicates, required this.needsAttention, required this.remaining});
  final int accepted, duplicates, needsAttention, remaining;
}

/// Encrypted, persisted queue of offline gate events.
///
/// - Payload encrypted with AES-256-GCM; the key is generated per device and stored in secure storage.
/// - Each event has a UUID `localId`; the server dedupes on it, so re-sending after a crash is safe.
/// - Only ENTRY/EXIT with cash are queued. Digital payments are never accepted offline.
class OfflineQueue {
  OfflineQueue(this._kv, {this.namespace = 'p2a.offline'});
  final KeyValueStore _kv;
  final String namespace;
  final _aes = AesGcm.with256bits();
  SecretKey? _key;
  List<OfflineEvent> _pending = [];
  List<AttentionItem> _attention = [];
  bool _syncing = false;
  static const _uuid = Uuid();

  List<OfflineEvent> get pending => List.unmodifiable(_pending);
  List<AttentionItem> get attention => List.unmodifiable(_attention);
  int pendingEntries(String facilityId) => _pending.where((e) => e.type == 'ENTRY' && e.facilityId == facilityId).length;

  Future<SecretKey> _deviceKey() async {
    if (_key != null) return _key!;
    final stored = await _kv.read('$namespace.key');
    if (stored != null) return _key = SecretKey(base64Decode(stored));
    final rnd = Random.secure();
    final bytes = List<int>.generate(32, (_) => rnd.nextInt(256));
    await _kv.write('$namespace.key', base64Encode(bytes));
    return _key = SecretKey(bytes);
  }

  Future<void> load() async {
    final blob = await _kv.read('$namespace.data');
    if (blob == null) return;
    final box = SecretBox.fromConcatenation(base64Decode(blob), nonceLength: 12, macLength: 16);
    final clear = await _aes.decrypt(box, secretKey: await _deviceKey());
    final j = jsonDecode(utf8.decode(clear)) as Map<String, dynamic>;
    _pending = (j['pending'] as List).map((e) => OfflineEvent.fromJson((e as Map).cast<String, dynamic>())).toList();
    _attention = (j['attention'] as List).map((e) => AttentionItem.fromJson((e as Map).cast<String, dynamic>())).toList();
  }

  Future<void> _persist() async {
    final clear = utf8.encode(jsonEncode({'pending': _pending.map((e) => e.toJson()).toList(), 'attention': _attention.map((e) => e.toJson()).toList()}));
    final box = await _aes.encrypt(clear, secretKey: await _deviceKey());
    await _kv.write('$namespace.data', base64Encode(box.concatenation()));
  }

  /// Raw stored blob — exposed for tests asserting nothing is stored in clear text.
  Future<String?> rawBlob() => _kv.read('$namespace.data');

  Future<OfflineEvent> enqueueEntry({required String facilityId, required String plate, required String vehicleClass, String? gateId, required int maxProvisionalEntries, DateTime? at}) async {
    if (pendingEntries(facilityId) >= maxProvisionalEntries) throw OfflineLimitReached(maxProvisionalEntries);
    return _add(OfflineEvent(localId: 'off-${_uuid.v4()}', type: 'ENTRY', occurredAt: at ?? DateTime.now(), facilityId: facilityId, data: {'plate': plate, 'vehicleClass': vehicleClass, 'gateId': ?gateId}));
  }

  Future<OfflineEvent> enqueueExit({required String facilityId, required String plate, required int cashCollectedMinor, String? gateId, bool lostTicket = false, DateTime? at}) =>
      _add(OfflineEvent(localId: 'off-${_uuid.v4()}', type: 'EXIT', occurredAt: at ?? DateTime.now(), facilityId: facilityId, data: {'plate': plate, 'cashCollectedMinor': cashCollectedMinor, 'gateId': ?gateId, if (lostTicket) 'lostTicket': true}));

  Future<OfflineEvent> _add(OfflineEvent e) async {
    _pending.add(e);
    await _persist();
    return e;
  }

  Future<void> dismissAttention(String localId) async {
    _attention.removeWhere((a) => a.event.localId == localId);
    await _persist();
  }

  /// Uploads pending events per facility in batches. Safe to call repeatedly; network errors leave the queue intact.
  Future<SyncReport> sync(ApiClient api) async {
    if (_syncing || _pending.isEmpty) return SyncReport(accepted: 0, duplicates: 0, needsAttention: 0, remaining: _pending.length);
    _syncing = true;
    var accepted = 0, duplicates = 0, attention = 0;
    try {
      final byFacility = <String, List<OfflineEvent>>{};
      for (final e in _pending) {
        byFacility.putIfAbsent(e.facilityId, () => []).add(e);
      }
      for (final entry in byFacility.entries) {
        for (var i = 0; i < entry.value.length; i += 100) {
          final chunk = entry.value.sublist(i, min(i + 100, entry.value.length));
          final res = await api.post('/v1/gate/offline-sync', {'facilityId': entry.key, 'events': chunk.map((e) => e.toPayload()).toList()}) as Map<String, dynamic>;
          final byId = {for (final r in (res['results'] as List).cast<Map<String, dynamic>>()) r['localId'] as String: r};
          for (final e in chunk) {
            final r = byId[e.localId];
            if (r == null) continue; // not processed — keep pending
            _pending.removeWhere((p) => p.localId == e.localId);
            switch (r['status']) {
              case 'ACCEPTED':
                accepted++;
              case 'DUPLICATE':
                duplicates++;
              default:
                attention++;
                _attention.add(AttentionItem(event: e, status: r['status'], code: '${r['code'] ?? ''}', message: '${r['message'] ?? ''}'));
            }
          }
          await _persist();
        }
      }
    } finally {
      _syncing = false;
    }
    return SyncReport(accepted: accepted, duplicates: duplicates, needsAttention: attention, remaining: _pending.length);
  }
}
