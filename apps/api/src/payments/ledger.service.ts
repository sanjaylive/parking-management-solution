import { Injectable } from '@nestjs/common';
import { LedgerAccountType } from '@prisma/client';
import { randomUUID } from 'crypto';
import { Tx } from '../common/prisma.service';

const ACCOUNTS: Record<string, { name: string; type: LedgerAccountType }> = {
  CASH_DRAWER: { name: 'Cash in drawers', type: 'ASSET' },
  GATEWAY_CLEARING: { name: 'Payment gateway clearing', type: 'ASSET' },
  CORPORATE_RECEIVABLE: { name: 'Corporate receivables', type: 'ASSET' },
  PARKING_REVENUE: { name: 'Parking revenue', type: 'REVENUE' },
  PASS_REVENUE: { name: 'Pass revenue', type: 'REVENUE' },
  RESERVATION_LIABILITY: { name: 'Prepaid reservations', type: 'LIABILITY' },
  REFUNDS: { name: 'Refunds issued', type: 'EXPENSE' },
  CASH_VARIANCE: { name: 'Cash over/short', type: 'EXPENSE' },
  SAAS_REVENUE: { name: 'SaaS subscription revenue', type: 'REVENUE' },
};

export interface LedgerLine {
  account: keyof typeof ACCOUNTS;
  debitMinor?: number;
  creditMinor?: number;
}

/** Append-only double-entry ledger. All posts happen inside the caller's transaction. */
@Injectable()
export class LedgerService {
  async post(tx: Tx, p: { tenantId: string | null; refType: string; refId: string; memo?: string; lines: LedgerLine[] }) {
    const debit = p.lines.reduce((s, l) => s + (l.debitMinor ?? 0), 0);
    const credit = p.lines.reduce((s, l) => s + (l.creditMinor ?? 0), 0);
    if (debit !== credit || debit <= 0) throw new Error(`Unbalanced ledger txn: debit ${debit} credit ${credit}`);
    const txnId = randomUUID();
    for (const l of p.lines) {
      const acc = await this.account(tx, p.tenantId, l.account);
      await tx.financialLedgerEntry.create({
        data: {
          txnId, tenantId: p.tenantId, accountId: acc.id, debitMinor: l.debitMinor ?? 0, creditMinor: l.creditMinor ?? 0,
          refType: p.refType, refId: p.refId, memo: p.memo,
        },
      });
    }
    return txnId;
  }

  private async account(tx: Tx, tenantId: string | null, code: string) {
    const def = ACCOUNTS[code];
    const found = await tx.financialLedgerAccount.findFirst({ where: { tenantId, code } });
    if (found) return found;
    if (tenantId === null) return tx.financialLedgerAccount.create({ data: { tenantId: null, code, name: def.name, type: def.type } });
    return tx.financialLedgerAccount.upsert({
      where: { tenantId_code: { tenantId: tenantId as string, code } },
      update: {},
      create: { tenantId, code, name: def.name, type: def.type },
    });
  }
}
