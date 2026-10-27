import { Suspense } from "react";
import { Page, PageHeading } from "@/components/ui/page";
import { ResolutionClient } from "./components/ResolutionClient";

/** The page's heading, prerendered while the browser reads the selected market. */
function ResolutionShell() {
  return (
    <Page>
      <PageHeading
        title="Resolution"
        description={
          <>
            From open books to a settled outcome.
            <br />
            Public evidence, canonical payouts, and claim redemption.
          </>
        }
      />
    </Page>
  );
}

// The selected market (`?market=`) is read in the browser, so the page itself is static.
export function ResolutionPageModule() {
  return (
    <Suspense fallback={<ResolutionShell />}>
      <ResolutionClient markets={[]} />
    </Suspense>
  );
}
