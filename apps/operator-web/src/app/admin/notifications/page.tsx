'use client';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Megaphone, X } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { Button, Input, SectionTitle } from '@park2all/web-ui';
import { NotificationCenter } from '@/components/notifications';
import { api } from '@/lib/api';
import { Select, Textarea } from '../ui';

function Composer({ onClose }: { onClose: () => void }) {
  const [audience, setAudience] = useState('all_operators');
  const tenants = useQuery({ queryKey: ['admin', 'tenants', 'all'], queryFn: () => api('/v1/admin/tenants?pageSize=100'), enabled: audience === 'tenant' });
  const send = useMutation({
    mutationFn: (b: unknown) => api<{ sent: number }>('/v1/admin/notifications/broadcast', { method: 'POST', json: b }),
    onSuccess: (r) => { toast.success(`Announcement sent to ${r.sent} ${r.sent === 1 ? 'person' : 'people'}`); onClose(); },
    onError: (e) => toast.error((e as Error).message),
  });
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    send.mutate({ audience, tenantId: audience === 'tenant' ? f.tenantId : undefined, title: f.title.trim(), body: f.body.trim(), severity: f.severity, link: f.link?.trim() || undefined });
  }
  return (
    <form onSubmit={submit} className="card space-y-4 p-5">
      <SectionTitle title="New announcement" sub="Delivered instantly to the bell of everyone in the audience." action={<button type="button" onClick={onClose} className="grid size-8 place-items-center rounded-lg text-muted hover:bg-surface-2" aria-label="Close"><X className="size-4" /></button>} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Select name="audience" label="Audience" value={audience} onChange={(e) => setAudience(e.target.value)}>
          <option value="all_operators">All operators (owners & managers)</option>
          <option value="tenant">One operator</option>
          <option value="platform_admins">Platform team</option>
        </Select>
        {audience === 'tenant' && (
          <Select name="tenantId" label="Operator" required defaultValue="">
            <option value="" disabled>{tenants.isLoading ? 'Loading…' : 'Choose an operator'}</option>
            {tenants.data?.items.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
        )}
        <Select name="severity" label="Priority" defaultValue="info">
          <option value="info">Info</option><option value="success">Good news</option><option value="warning">Warning</option><option value="critical">Critical</option>
        </Select>
      </div>
      <Input name="title" label="Title" required minLength={3} maxLength={120} placeholder="Scheduled maintenance on Sunday" />
      <Textarea name="body" label="Message" required minLength={3} maxLength={1000} placeholder="The console will be unavailable from 02:00 to 02:30 IST." />
      <Input name="link" label="Link inside the app (optional)" pattern="/.*" title="An in-app path starting with /" placeholder="/dashboard" />
      <Button type="submit" loading={send.isPending}><Megaphone className="size-4" />Send announcement</Button>
    </form>
  );
}

export default function AdminNotifications() {
  const [composing, setComposing] = useState(false);
  return (
    <NotificationCenter header={composing ? <Composer onClose={() => setComposing(false)} /> : (
      <button onClick={() => setComposing(true)} className="flex w-full items-center gap-3 rounded-2xl border border-dashed border-border bg-surface p-4 text-left transition hover:border-brand hover:bg-brand/5">
        <span className="grid size-10 place-items-center rounded-xl bg-grad text-white"><Megaphone className="size-5" /></span>
        <span><span className="block font-semibold">Send an announcement</span><span className="text-sm text-muted">Notify all operators, one operator, or the platform team.</span></span>
      </button>
    )} />
  );
}
