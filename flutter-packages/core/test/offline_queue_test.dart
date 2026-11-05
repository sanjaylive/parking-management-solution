import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:p2a_core/p2a_core.dart';

/// Fake server: records requests and answers offline-sync like the real API contract.
class FakeAdapter implements HttpClientAdapter {
  FakeAdapter(this.handler);
  final ResponseBody Function(RequestOptions o) handler;
  final calls = <RequestOptions>[];
  @override
  Future<ResponseBody> fetch(RequestOptions o, Stream<List<int>>? body, Future<void>? cancel) async {
    calls.add(o);
    return handler(o);
  }
  @override
  void close({bool force = false}) {}
}

ResponseBody json(String s, [int status = 200]) => ResponseBody.fromString(s, status, headers: {'content-type': ['application/json']});

void main() {
  late MemoryKeyValueStore kv;
  setUp(() => kv = MemoryKeyValueStore());

  test('queue is persisted encrypted and survives reload', () async {
    final q = OfflineQueue(kv);
    await q.enqueueEntry(facilityId: 'f1', plate: 'KA01AB1234', vehicleClass: 'CAR', maxProvisionalEntries: 5);
    final raw = await q.rawBlob();
    expect(raw, isNotNull);
    expect(raw!.contains('KA01AB1234'), isFalse, reason: 'plate must not be stored in clear text');
    final reloaded = OfflineQueue(kv);
    await reloaded.load();
    expect(reloaded.pending.single.data['plate'], 'KA01AB1234');
  });

  test('tampered blob fails authentication', () async {
    final q = OfflineQueue(kv);
    await q.enqueueEntry(facilityId: 'f1', plate: 'KA01AB1234', vehicleClass: 'CAR', maxProvisionalEntries: 5);
    final raw = kv.data['p2a.offline.data']!;
    kv.data['p2a.offline.data'] = raw.replaceRange(20, 24, raw.substring(20, 24) == 'AAAA' ? 'BBBB' : 'AAAA');
    expect(OfflineQueue(kv).load(), throwsA(anything));
  });

  test('enforces offline provisional entry limit per facility', () async {
    final q = OfflineQueue(kv);
    await q.enqueueEntry(facilityId: 'f1', plate: 'KA01AA0001', vehicleClass: 'CAR', maxProvisionalEntries: 2);
    await q.enqueueEntry(facilityId: 'f1', plate: 'KA01AA0002', vehicleClass: 'CAR', maxProvisionalEntries: 2);
    expect(() => q.enqueueEntry(facilityId: 'f1', plate: 'KA01AA0003', vehicleClass: 'CAR', maxProvisionalEntries: 2), throwsA(isA<OfflineLimitReached>()));
    await q.enqueueEntry(facilityId: 'f2', plate: 'KA01AA0003', vehicleClass: 'CAR', maxProvisionalEntries: 2);
  });

  test('sync removes accepted/duplicates, moves conflicts to attention, keeps queue on network failure', () async {
    final q = OfflineQueue(kv);
    final a = await q.enqueueEntry(facilityId: 'f1', plate: 'KA01AA0001', vehicleClass: 'CAR', maxProvisionalEntries: 9);
    final b = await q.enqueueEntry(facilityId: 'f1', plate: 'KA01AA0002', vehicleClass: 'CAR', maxProvisionalEntries: 9);
    final c = await q.enqueueExit(facilityId: 'f1', plate: 'KA01AA0003', cashCollectedMinor: 5000);

    final sessions = SessionStore(kv);
    await sessions.save(Session(accessToken: 'tok', refreshToken: 'r', tenantId: 't1'));

    // 1. Network down → nothing lost
    final down = Dio(BaseOptions(baseUrl: 'http://x'));
    down.httpClientAdapter = FakeAdapter((o) => throw DioException.connectionError(requestOptions: o, reason: 'offline'));
    await expectLater(q.sync(ApiClient(baseUrl: 'http://x', sessions: sessions, dio: down)), throwsA(isA<ApiException>().having((e) => e.isNetwork, 'isNetwork', true)));
    expect(q.pending, hasLength(3));

    // 2. Server back
    final up = Dio(BaseOptions(baseUrl: 'http://x'));
    final adapter = FakeAdapter((o) => json('{"results":[{"localId":"${a.localId}","status":"ACCEPTED"},{"localId":"${b.localId}","status":"DUPLICATE"},{"localId":"${c.localId}","status":"CONFLICT","code":"SESSION_NOT_FOUND","message":"No session"}]}'));
    up.httpClientAdapter = adapter;
    final report = await q.sync(ApiClient(baseUrl: 'http://x', sessions: sessions, dio: up));
    expect(adapter.calls.single.headers['x-tenant-id'], 't1');
    expect(adapter.calls.single.headers['authorization'], 'Bearer tok');
    final sent = (adapter.calls.single.data as Map)['events'] as List;
    expect(sent.map((e) => e['localId']), [a.localId, b.localId, c.localId]);
    expect(report.accepted, 1);
    expect(report.duplicates, 1);
    expect(report.needsAttention, 1);
    expect(q.pending, isEmpty);
    expect(q.attention.single.code, 'SESSION_NOT_FOUND');

    // persisted
    final reloaded = OfflineQueue(kv);
    await reloaded.load();
    expect(reloaded.pending, isEmpty);
    expect(reloaded.attention, hasLength(1));
  });
}
