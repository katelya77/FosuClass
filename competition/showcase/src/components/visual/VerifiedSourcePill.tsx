import { ShieldCheck } from 'lucide-react';

/** 统一可信来源徽标：viewport 级固定在右下安全区，不参与场景内容流。 */
export function VerifiedSourcePill(): JSX.Element {
  return (
    <span className='verified-source-pill chip border-line-strong' role='note' data-qa-proof-chip>
      <ShieldCheck size={13} className='text-ok' />
      已核验 CampusTools · competition-demo-v3
    </span>
  );
}
