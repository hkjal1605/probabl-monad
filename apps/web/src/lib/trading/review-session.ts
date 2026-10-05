import { ApiError } from "../../services/protocol-api-service";

/** Retry read-only review once after an explicit authentication rejection. `session` is the
 * sign-in to review under; without one the request asks for the current sign-in (`true`), which
 * fails before any network call when there is none. */
export async function reviewWithSession<T>(options: {
  session: string | null;
  request: (auth: string | true) => Promise<T>;
  authenticate: () => Promise<string>;
  assertCurrent: () => void;
}) {
  try {
    return await options.request(options.session ?? true);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error;
    // requestJson invalidates the rejected session before throwing. Authentication
    // can reuse a newer session if this was a late response for an older sign-in.
    options.assertCurrent();
    const session = await options.authenticate();
    options.assertCurrent();
    return options.request(session);
  }
}
