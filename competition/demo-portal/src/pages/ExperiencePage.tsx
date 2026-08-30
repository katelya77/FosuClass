import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { Check, Clipboard, MousePointerClick, Send, ShieldCheck } from "lucide-react";

import { AdpExperience } from "../components/AdpExperience";
import { CapabilityQuestionLibrary } from "../components/CapabilityQuestionLibrary";
import { MagneticButton } from "../components/MagneticButton";
import { AGENT_BRANDS, CHAT_BACKGROUND } from "../data/branding";
import { EXPERIENCE_TABS, GENERAL_EXPERIENCE, getCaseByKey } from "../data/cases";
import { cn } from "../lib/cn";
import { consumePendingPrompt } from "../lib/pending";
import { type Route } from "../lib/router";

interface ExperiencePageProps {
  caseKey?: string;
  onNavigate: (route: Route) => void;
  recordMode?: boolean;
}

export function ExperiencePage({ caseKey, onNavigate, recordMode = false }: ExperiencePageProps): ReactElement {
  const active = getCaseByKey(caseKey) ?? GENERAL_EXPERIENCE;
  const isGeneral = active.key === "general";
  const activeBrandId = {
    general: "coordinator",
    query: "course",
    collaboration: "coordinator",
    reschedule: "risk",
    insight: "insight",
  }[active.key];
  const activeBrand = AGENT_BRANDS.find((item) => item.id === activeBrandId) ?? AGENT_BRANDS[0];
  const pendingPrompt = useMemo(() => consumePendingPrompt(), []);
  const [prompt, setPrompt] = useState(pendingPrompt ?? active.fullPrompt);
  const previousCaseKey = useRef(active.key);

  useEffect(() => {
    if (previousCaseKey.current === active.key) return;
    previousCaseKey.current = active.key;
    setPrompt(active.fullPrompt);
  }, [active.fullPrompt, active.key]);

  const [copied, setCopied] = useState(false);
  useEffect(() => {
    setCopied(false);
  }, [active.key, prompt]);

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  if (recordMode) {
    return (
      <div className="experience-page experience-page--record mx-auto max-w-[1460px] px-6 py-5" data-qa-portal-recording>
        <section className="recording-experience-stage flex min-h-0 flex-col gap-4">
          <div className="recording-question liquid-glass flex items-center gap-5 rounded-[24px] px-6 py-4">
            <span>用户问题</span>
            <strong>{prompt}</strong>
          </div>
          <AdpExperience className="min-h-0 flex-1" initialPrompt={prompt} recordMode />
        </section>
      </div>
    );
  }

  return (
    <div className="experience-page mx-auto max-w-[1500px] px-4 pb-24 pt-5 sm:px-6 sm:pt-8">
      <div className="experience-case-tabs mb-4 flex flex-wrap items-center gap-2">
        {EXPERIENCE_TABS.map((item) => {
          const Icon = item.icon;
          const isActive = item.key === active.key;
          return (
            <button
              key={item.key}
              onClick={() => onNavigate({ name: "experience", caseKey: item.key })}
              className={cn(
                "inline-flex items-center gap-2 rounded-full border border-white/60 px-3 py-1.5 text-xs font-medium backdrop-blur-md transition-all",
                isActive ? "bg-white/55 text-brand-deep" : "bg-white/25 text-mute hover:bg-white/40",
              )}
              style={
                isActive
                  ? { boxShadow: "inset 0 1px 0 rgba(255,255,255,0.8), 0 5px 14px rgba(217,89,63,0.14)" }
                  : undefined
              }
            >
              <Icon size={14} />
              {item.title}
            </button>
          );
        })}
        <span className="ml-auto hidden items-center gap-2 text-xs text-mute sm:flex">
          <MousePointerClick size={14} />
          把左侧问题直接发给真实小序
        </span>
      </div>

      <div className="liquid-glass mb-4 flex items-start gap-3 rounded-2xl px-4 py-3">
        <ShieldCheck size={16} className="mt-0.5 shrink-0" style={{ color: "#237f69" }} />
        <p className="text-xs leading-relaxed text-body sm:text-sm">
          <strong className="text-ink">真实体验</strong>
          ——这里是已发布小序的真实回答：官方接口调用、匿名演示数据、结果卡携带核验依据；左侧问题可直接发送，实时不可用时会明确告知并提供已核验回放。
        </p>
      </div>

      <div className={cn(
        "experience-layout grid gap-4 lg:grid-cols-[28%_minmax(0,1fr)] lg:gap-5",
        isGeneral && "is-general",
      )}>
        <section className="experience-stage-shell order-1 flex min-h-[540px] flex-col gap-3 lg:order-2 lg:col-start-2 lg:row-start-1">
          <div className="experience-storyline" aria-label="体验流程">
            {[
              ["问题", "你用自然语言提问"],
              ["协作", "Multi-Agent 分工"],
              ["核验", "CampusTools 计算"],
              ["结论", "给出清楚答案"],
            ].map(([label, detail], index) => (
              <div key={label} className="experience-story-step">
                <span>{index + 1}</span>
                <div><strong>{label}</strong><small>{detail}</small></div>
              </div>
            ))}
          </div>
          <AdpExperience
            className="min-h-[540px] flex-1"
            initialPrompt={prompt}
          />
        </section>

        <aside className="experience-guide liquid-glass order-2 flex flex-col gap-4 rounded-[30px] p-4 sm:gap-5 sm:p-5 lg:order-1 lg:col-start-1 lg:row-start-1">
          <img src={CHAT_BACKGROUND.image} alt="" aria-hidden className="experience-guide-bg" />
          <div className="flex items-start gap-3">
            <img src={activeBrand.image} alt={activeBrand.name} className="size-14 shrink-0 rounded-[18px] object-contain drop-shadow-[0_10px_18px_rgba(143,47,34,0.2)]" />
            <div>
              <span className="text-xs font-semibold tracking-[0.2em] text-brand">{active.eyebrow}</span>
              <h1 className="mt-1 text-2xl font-bold text-ink">{active.title}</h1>
            </div>
          </div>
          {isGeneral ? (
            <CapabilityQuestionLibrary selectedPrompt={prompt} onSelect={setPrompt} />
          ) : (
            <>
              <div>
                <p className="text-sm font-semibold text-body">这次想解决什么</p>
                <p className="mt-1 text-sm leading-relaxed text-body">{active.taskLabel}</p>
              </div>

              <div className="experience-prompt-card rounded-2xl border border-white/35 bg-white/24 p-4">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-deep">
                  <Send size={13} />
                  你问小序
                </span>
                <p className="mt-2 text-sm leading-relaxed text-ink">{prompt}</p>
              </div>

              <div className="experience-steps">
                <p className="text-xs font-semibold text-mute">小序会这样做</p>
                <ol className="mt-3 space-y-2.5">
                  {active.steps.map((step, index) => (
                    <li key={step} className="flex items-center gap-3">
                      <span
                        className="flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-[#fff7f3]"
                        style={{
                          background: "linear-gradient(135deg, #e96d51 0%, #c44534 100%)",
                          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.4), 0 5px 12px rgba(184,57,39,0.22)",
                        }}
                      >
                        {index + 1}
                      </span>
                      <span className="text-sm text-body">{step}</span>
                    </li>
                  ))}
                </ol>
              </div>

              <div className="experience-context">
                <p className="text-xs font-semibold text-mute">上下文</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {active.context.map((item) => (
                    <span
                      key={item.label}
                      className="flow-chip"
                      title={item.value.length > 28 ? item.value : undefined}
                    >
                      <span className="text-mute">{item.label}</span>
                      <strong>{item.value}</strong>
                    </span>
                  ))}
                </div>
              </div>

              <div className="experience-guide-footer flex flex-col gap-2 border-t border-white/25 pt-4">
                <MagneticButton
                  variant="glass"
                  onClick={copyPrompt}
                  className="w-full px-4 py-2.5 text-sm"
                >
                  {copied ? <Check size={15} /> : <Clipboard size={15} />}
                  {copied ? "已复制问题" : "复制这段问题"}
                </MagneticButton>
                <p className="px-2 text-center text-[11px] leading-relaxed text-mute">
                  右侧通过官方 SSE 调用已发布 Multi-Agent
                </p>
              </div>
            </>
          )}
        </aside>

      </div>
    </div>
  );
}
