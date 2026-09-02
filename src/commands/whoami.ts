import { ExitCode } from "../errors.ts";
import { printHuman, printJson } from "../output.ts";
import type { Command } from "./types.ts";

const USAGE = "Usage: rinth whoami";

export const whoamiCommand: Command = {
  name: "whoami",
  describe: "Show the authenticated Modrinth user",

  usage() {
    return USAGE;
  },

  async run(_args, ctx) {
    const user = await ctx.transport.getCurrentUser();

    if (ctx.json) {
      printJson(user);
    } else {
      // RINTH-22: `role` is included because it answers the decision a
      // reader actually runs `whoami` to make — "is this the identity/token
      // I think it is" — in a way username/id alone don't (a moderator vs.
      // developer token behaves differently). Everything else on the user
      // object is either already answered by username/id, PII (email), or
      // secret-adjacent (payout_data, has_totp/has_password) and must never
      // reach stdout regardless of whether it would help this decision.
      printHuman(`${user.username} (${user.id}) [${user.role}]`);
    }

    return ExitCode.Ok;
  },
};
