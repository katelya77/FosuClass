import type { ReactElement } from "react";
import { CheckCircle2, MousePointerClick, Sparkles } from "lucide-react";

import { AGENT_BRANDS } from "../data/branding";
import { AGENT_QUESTION_GROUPS } from "../data/questionCatalog";
import { cn } from "../lib/cn";

interface CapabilityQuestionLibraryProps {
  selectedPrompt: string;
  onSelect: (prompt: string) => void;
}

export function CapabilityQuestionLibrary({
  selectedPrompt,
  onSelect,
}: CapabilityQuestionLibraryProps): ReactElement {
  return (
    <div className="capability-question-library">
      <div className="capability-question-library__intro">
        <div>
          <span><Sparkles size={13} /> 能问什么</span>
          <strong>从常用查询到跨域决策</strong>
        </div>
        <small><MousePointerClick size={12} /> 点一个问题，直接带入右侧</small>
      </div>

      <p className="capability-question-library__scope">
        教师 / 班级 / 课程 / 教室课表 · 协同排程 · 风险与调课 · 负载与态势
      </p>

      <div className="capability-question-library__groups">
        {AGENT_QUESTION_GROUPS.map((group) => {
          const brand = AGENT_BRANDS.find((item) => item.id === group.agentId)!;
          return (
            <section key={group.agentId} className="capability-agent-group">
              <header>
                <img src={brand.image} alt="" aria-hidden />
                <div>
                  <strong>{group.name}</strong>
                  <small>{group.role}</small>
                </div>
                <span>{group.widget}</span>
              </header>
              <div className="capability-agent-group__questions">
                {group.questions.map((question) => (
                  <button
                    key={question.text}
                    type="button"
                    title={question.text}
                    onClick={() => onSelect(question.text)}
                    className={cn(
                      selectedPrompt === question.text && "is-selected",
                      question.golden && "is-golden",
                    )}
                  >
                    <i aria-hidden />
                    <span>{question.text}</span>
                    {question.golden && <b>Golden</b>}
                  </button>
                ))}
              </div>
            </section>
          );
        })}
      </div>

      <div className="capability-question-library__proof">
        <CheckCircle2 size={13} />
        <span><strong>4 Agent</strong> 协作 · <strong>13 CampusTools</strong> 核验 · 7 类 Widget 结果</span>
      </div>
    </div>
  );
}
