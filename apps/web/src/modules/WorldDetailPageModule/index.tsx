import { Page } from "@/components/ui/page";
import { WorldDetail } from "./components/WorldDetail";

export function WorldDetailPageModule({ book }: { book: string }) {
  return (
    <Page className="max-w-[1180px] px-4 pb-16 sm:px-6">
      <WorldDetail key={book} book={book} />
    </Page>
  );
}
