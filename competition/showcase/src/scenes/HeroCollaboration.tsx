import { Check, DoorOpen, Users } from 'lucide-react';
import { motion } from 'motion/react';
import { SceneHeader } from '../components/primitives/SceneHeader';
import { Badge } from '../components/primitives/Badge';
import { Panel } from '../components/primitives/Panel';
import { rise } from '../components/primitives/motion';
import { heroesFixture } from '../fixtures/heroes';

interface Track {
  label: string;
  busy: Array<[number, number]>; // [left%, width%]
}

const TRACKS: Track[] = [
  { label: '教师003', busy: [[4, 26], [70, 22]] },
  { label: '教师009', busy: [[16, 18], [72, 20]] },
  { label: '示例2班', busy: [[6, 30], [74, 18]] },
];

const COMMON = { left: 38, width: 24 };

/** 参与人 chips */
export function ParticipantChips(): JSX.Element {
  return (
    <div className='flex flex-wrap items-center gap-2'>
      <Badge tone='brand' icon={<Users size={13} />}>教师003</Badge>
      <Badge tone='brand' icon={<Users size={13} />}>教师009</Badge>
      <Badge tone='brand' icon={<Users size={13} />}>示例2班</Badge>
      <span className='t-caption ml-1'>
        共同空闲窗口 × {heroesFixture.payload.commonFreeWindowsWeek1}（第 1 周）
      </span>
    </div>
  );
}

/** 共同空闲交集时间轴 */
export function IntersectionTimeline(): JSX.Element {
  return (
    <Panel
      kicker='时间交集 · Common Free Time'
      title='三条忙碌线，一个共同窗口'
      badge={<Badge tone='brand'>campus_common_free_time_query</Badge>}
      className='min-h-0 flex-1'
    >
      <div className='relative flex h-full min-h-[180px] flex-col justify-center gap-4 pr-2'>
        <div
          aria-hidden
          className='pointer-events-none absolute inset-y-0 rounded-md border-x-2 border-brand bg-[var(--brand-dim)]'
          style={{ left: COMMON.left + '%', width: COMMON.width + '%' }}
        />
        {TRACKS.map((t, i) => (
          <motion.div
            key={t.label}
            {...rise(0.9 + i * 0.35, 12)}
            className='relative z-10 flex items-center gap-4'
          >
            <span className='w-20 shrink-0 text-right text-[13px] tracking-wide text-mute'>{t.label}</span>
            <div className='relative h-12 flex-1 overflow-hidden rounded-lg border border-line bg-canvas-deep'>
              {t.busy.map(([l, wd], j) => (
                <div
                  key={j}
                  className='absolute inset-y-1.5 rounded-md border border-line-strong bg-raised'
                  style={{ left: l + '%', width: wd + '%' }}
                >
                  <span className='absolute inset-0 flex items-center justify-center text-[11px] text-faint'>已占用</span>
                </div>
              ))}
            </div>
          </motion.div>
        ))}
        <div
          className='absolute -top-1 z-10 -translate-x-1/2 whitespace-nowrap'
          style={{ left: COMMON.left + COMMON.width / 2 + '%' }}
        >
          <span className='chip border-[color-mix(in_srgb,var(--brand)_45%,transparent)] text-brand'>共同空闲 · 周三 08:00–09:35</span>
        </div>
      </div>
    </Panel>
  );
}

/** 推荐空间主卡 */
export function RoomHeroCard(): JSX.Element {
  return (
    <Panel raised kicker='空间匹配 · Room' title='教室 A-201' badge={<Badge tone='brand'><Check size={13} />推荐主方案</Badge>}>
      <ul className='space-y-2.5'>
        {['容量 ≥ 60 座', '投影满足', '电源插座满足'].map((row) => (
          <li key={row} className='flex items-center gap-3 text-[15px]'>
            <Check size={16} className='shrink-0 text-ok' />
            <span>{row}</span>
          </li>
        ))}
      </ul>
      <p className='t-caption mt-4'>校区A · 群体计划 campus_group_plan 输出候选之一</p>
    </Panel>
  );
}

/** 备选空间列表 */
export function AlternativeRooms(): JSX.Element {
  const others = ['教室 A-105', '教室 A-203', '教室 B-201'];
  return (
    <Panel kicker='备选空间 · Alternatives' title={'其余可用 ' + (heroesFixture.payload.roomsCapacity60Plus - 1) + ' 间'}>
      <ul className='divide-y divide-[var(--border)]'>
        {others.map((r) => (
          <li key={r} className='flex items-center justify-between py-2.5 text-[15px]'>
            <span className='flex items-center gap-2.5'>
              <DoorOpen size={15} className='text-stream' />
              {r}
            </span>
            <span className='t-caption'>容量 ≥ 60</span>
          </li>
        ))}
      </ul>
      <p className='t-caption mt-2'>另有 4 间 · 可继续翻页查看</p>
    </Panel>
  );
}

export function HeroCollaboration(): JSX.Element {
  return (
    <div className='stage-safe flex w-full flex-col gap-7'>
      <SceneHeader
        kicker='英雄场景 · 协作共创'
        title='多人共同空闲，如何自动匹配到合适空间'
        badge={<Badge tone='brand' icon={<Users size={14} />}>协作规划</Badge>}
      />
      <div className='grid min-h-0 flex-1 grid-cols-[1fr_430px] gap-6'>
        <motion.div className='flex min-h-0 flex-col gap-5' {...rise(0.6)}>
          <IntersectionTimeline />
          <ParticipantChips />
        </motion.div>
        <motion.div className='flex min-h-0 flex-col gap-6' {...rise(1.0)}>
          <RoomHeroCard />
          <AlternativeRooms />
        </motion.div>
      </div>
    </div>
  );
}