import { motion } from "motion/react";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";
import { T } from "../../motion/motionTokens";

export interface CameraShot {
  /** 缩放：>1 推近，<1 拉远 */
  scale?: number;
  x?: number;
  y?: number;
  /** 景深模糊：>0 表示仍在显影 */
  blur?: number;
  opacity?: number;
  /** 旋转（轻微荷兰角/呼吸），度数 */
  rotate?: number;
}

interface SceneCameraProps {
  shot?: CameraShot;
  children: ReactNode;
  className?: string;
  /** 为 true 时使用导演镜头缓动（更慢、强进强出） */
  cinematic?: boolean;
}

/**
 * SceneCamera —— 让每个 Scene 拥有镜头语言，而非"页面换页面"。
 * 通过 scale / translate / blur / opacity / rotate 完成 Push In、Pull Back、Focus、Reveal。
 * 场景由自己的节拍时钟计算 shot 传入，实现"焦点移动/信息逐步显影"。
 */
export function SceneCamera({ shot, children, className, cinematic }: SceneCameraProps): JSX.Element {
  return (
    <motion.div
      className={cn("relative h-full w-full will-change-transform", className)}
      initial={false}
      animate={{
        scale: shot?.scale ?? 1,
        x: shot?.x ?? 0,
        y: shot?.y ?? 0,
        rotate: shot?.rotate ?? 0,
        filter: "blur(" + (shot?.blur ?? 0) + "px)",
        opacity: shot?.opacity ?? 1,
      }}
      transition={cinematic ? T.camera : T.scene}
      style={{ transformOrigin: "52% 46%" }}
    >
      {children}
    </motion.div>
  );
}
