import { ShieldCheck } from 'lucide-react';

/** 统一可信来源徽标：低调出现在每个 Hero 底部，不抢主标题 */
export function VerifiedSourcePill(): JSX.Element {
  return (
    <span className='chip border-line-strong' role='note'>
      <ShieldCheck size={13} className='text-ok' />
      已核验 CampusTools · competition-demo-v3
    </span>
  );
}