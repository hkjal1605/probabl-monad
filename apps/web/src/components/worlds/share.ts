import { toast } from "@/components/ui/toast";

/** Shares a world's link: through the phone's share sheet on a touch screen that has one (to a
 * chat, a post, a note), else by copying it. Closing the share sheet is not an error. */
export async function shareLink(url: string, title?: string) {
  if (typeof navigator.share === "function" && window.matchMedia("(pointer: coarse)").matches) {
    try {
      await navigator.share(title ? { url, title } : { url });
      return;
    } catch (error) {
      if ((error as Error).name === "AbortError") return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast.add({ type: "success", title: "Link copied" });
  } catch {
    toast.add({ type: "error", title: url });
  }
}
