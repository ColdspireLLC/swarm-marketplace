import { expect, test } from "swarm/test";
import { endsHold } from "./turnend";

test("a late end of an earlier turn keeps a machine's hold", () => {
	expect(endsHold(2, 1)).toBe(false);
	expect(endsHold(2, 2)).toBe(true);
	expect(endsHold(2, 3)).toBe(true);
	expect(endsHold(undefined, 1)).toBe(true);
	expect(endsHold(2, undefined)).toBe(true);
});
