import { describe, expect, it } from 'vitest';
import { buildRiskViewModel } from './riskAdapter';
import { buildCollaborationViewModel } from './collaborationAdapter';
import { buildRescheduleViewModel } from './rescheduleAdapter';
import { buildInsightViewModel } from './insightAdapter';

describe('RiskViewModel —— 教师025 风险发现', () => {
  const vm = buildRiskViewModel();

  it('第1周14个课次，冲突0但赶场4（WARNING≠FAIL 的核心证据）', () => {
    expect(vm.blocks).toHaveLength(14);
    expect(vm.totals.conflictCount).toBe(0);
    expect(vm.totals.rushWarningCount).toBe(4);
  });

  it('四周口径一致且赶场链均为20分钟跨校区', () => {
    expect(vm.perWeekRisk).toHaveLength(4);
    for (const w of vm.perWeekRisk) {
      expect(w.conflictCount).toBe(0);
      expect(w.rushWarningCount).toBe(4);
    }
    for (const link of vm.rushLinks) {
      expect(link.gapMinutes).toBe(20);
      expect(link.fromCampus).not.toBe(link.toCampus);
    }
  });
});

describe('CollaborationViewModel —— 三人交集与空间漏斗', () => {
  const vm = buildCollaborationViewModel();

  it('唯一共同空闲=周四第1-4节', () => {
    expect(vm.participants).toEqual(['教师005', '教师006', '教师014']);
    expect(vm.slot.weekdayName).toBe('周四');
    expect(vm.slot.periodText).toBe('第1-4节');
  });

  it('漏斗 63 → ≥120座7间 → 推荐 A1-201(120)', () => {
    expect(vm.funnel.allRoomsAvailable).toBe(63);
    expect(vm.funnel.capacity120Plus).toBe(7);
    expect(vm.recommended.name).toBe('A1-201');
    expect(vm.recommended.capacity).toBe(120);
    expect(vm.candidatesCap120).toHaveLength(7);
  });
});

describe('RescheduleViewModel —— 可行性与提示并存', () => {
  const vm = buildRescheduleViewModel();

  it('feasible=true 且 warning 并存；mutatedData=false', () => {
    expect(vm.feasible).toBe(true);
    expect(vm.warningText).toContain('连续 4 节');
    expect(vm.mutatedData).toBe(false);
  });

  it('约束矩阵6行：5 PASS + 1 提示，无 FAIL', () => {
    expect(vm.constraints).toHaveLength(6);
    expect(vm.constraints.filter((r) => r.status === 'pass')).toHaveLength(5);
    expect(vm.constraints.filter((r) => r.status === 'warn')).toHaveLength(1);
    expect(vm.constraints.some((r) => r.status === 'fail')).toBe(false);
  });

  it('auto 解析建议 A1-201；候选名单为真实18间', () => {
    expect(vm.autoResolve.suggested.name).toBe('A1-201');
    expect(vm.autoResolve.spaceRoomCount).toBe(8);
    expect(vm.candidateNames).toContain('A1-201');
    expect(vm.candidateNames).toHaveLength(18);
    expect(vm.explicitRoom.name).toBe('A1-201');
  });
});

describe('InsightViewModel —— 排名与下钻一致性', () => {
  const vm = buildInsightViewModel();

  it('Top1 身份=排行首位：教师025 56课/112课时', () => {
    expect(vm.top1.name).toBe('教师025');
    expect(vm.top1.lessons).toBe(56);
    expect(vm.top1.periods).toBe(112);
    expect(vm.ranking[0].rank).toBe(1);
  });

  it('并列语义保留（rank4/rank6 为并列）且周课次=14×4', () => {
    expect(vm.ranking[3].tied).toBe(true);
    expect(vm.ranking[5].tied).toBe(true);
    expect(vm.drilldownWeeks.map((w) => w.lessons)).toEqual([14, 14, 14, 14]);
    expect(vm.riskSummary.rushWarningCount).toBe(4);
  });
});