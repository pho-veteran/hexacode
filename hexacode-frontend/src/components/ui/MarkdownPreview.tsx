import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeSanitize from "rehype-sanitize";
import { cn } from "@/lib/utils";

export function MarkdownPreview({ content, className }: { content: string; className?: string }) {
  return (
    <div
      className={cn(
        "markdown-preview text-[14px] leading-relaxed text-[var(--color-text-primary)]",
        "[&_h1]:text-[22px] [&_h1]:font-bold [&_h1]:mt-6 [&_h1]:mb-3",
        "[&_h2]:text-[18px] [&_h2]:font-semibold [&_h2]:mt-5 [&_h2]:mb-2",
        "[&_h3]:text-[15px] [&_h3]:font-semibold [&_h3]:mt-4 [&_h3]:mb-2",
        "[&_p]:mb-3 [&_p]:leading-relaxed",
        "[&_ul]:list-disc [&_ul]:pl-5 [&_ul]:mb-3",
        "[&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:mb-3",
        "[&_li]:mb-1",
        "[&_code]:rounded [&_code]:bg-[var(--color-bg-muted)] [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-[13px] [&_code]:font-mono",
        "[&_pre]:rounded-[var(--radius-md)] [&_pre]:bg-[var(--color-bg-muted)] [&_pre]:p-4 [&_pre]:mb-3 [&_pre]:overflow-x-auto [&_pre_code]:bg-transparent [&_pre_code]:p-0",
        "[&_blockquote]:border-l-2 [&_blockquote]:border-[var(--color-border-hair)] [&_blockquote]:pl-4 [&_blockquote]:text-[var(--color-text-secondary)] [&_blockquote]:mb-3",
        "[&_table]:w-full [&_table]:mb-3 [&_table]:text-[13px]",
        "[&_th]:text-left [&_th]:font-medium [&_th]:border-b [&_th]:border-[var(--color-border-hair)] [&_th]:px-2 [&_th]:py-1.5",
        "[&_td]:border-b [&_td]:border-[var(--color-border-hair)] [&_td]:px-2 [&_td]:py-1.5",
        "[&_a]:text-[var(--color-accent)] [&_a]:underline",
        "[&_hr]:my-4 [&_hr]:border-[var(--color-border-hair)]",
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex, rehypeSanitize]}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
