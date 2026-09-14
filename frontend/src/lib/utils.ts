import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** shadcn/Magic UI 约定：条件类名合并 + 后者覆盖前者（复制来的组件都 import 这个） */
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));
