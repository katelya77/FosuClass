// React 19 移除了全局 JSX 命名空间；这里恢复 JSX.Element 别名供注解使用。
import type { JSX as ReactJSX } from "react";

declare global {
  namespace JSX {
    export import Element = ReactJSX.Element;
  }
}
