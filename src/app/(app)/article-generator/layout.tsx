import { RequireRole } from "@/components/require-role";

export default function ArticleGeneratorLayout({ children }: { children: React.ReactNode }) {
  return <RequireRole route="/article-generator">{children}</RequireRole>;
}
