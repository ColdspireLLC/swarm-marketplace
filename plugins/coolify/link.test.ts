// What's worked out from Coolify's answers, alone: which of Swarm's projects
// an application is built from, a resource by the name a command gives,
// Coolify's times, and what --json leaves out.
import { expect, test } from "swarm/testing";
import { builtFrom, displayName, find, parseDotenv, parseTime, repoPath, toDotenv, withoutSecrets, type Place, type Resource } from "./coolify";

const app = (r: Partial<Resource>): Resource => ({ uuid: "u", name: "n", type: "application", status: "running:healthy", ...r });

test("an application links to the repository it's built from, by git or by image", () => {
	expect(repoPath("git@gitlab.coldspire.com:coldspire/conduish.git")).toBe("coldspire/conduish");
	expect(repoPath("https://github.com/Acme/Web/")).toBe("acme/web");
	expect(repoPath("ssh://git@host:2222/acme/web.git")).toBe("acme/web");
	expect(builtFrom(app({ build_pack: "railpack", git_repository: "coldspire/website" }), "coldspire/website")).toBe(true);
	expect(builtFrom(app({ build_pack: "nixpacks", git_repository: "https://github.com/acme/web" }), "acme/web")).toBe(true);
	expect(builtFrom(app({ build_pack: "nixpacks", git_repository: "acme/web" }), "acme/website")).toBe(false);
	// A docker image's application: its git_repository is Coolify's placeholder.
	const image = app({ build_pack: "dockerimage", git_repository: "coollabsio/coolify", docker_registry_image_name: "registry.gitlab.coldspire.com/coldspire/conduish/website" });
	expect(builtFrom(image, "coldspire/conduish")).toBe(true);
	expect(builtFrom(image, "coollabsio/coolify")).toBe(false);
	expect(builtFrom(image, "coldspire/con")).toBe(false);
	expect(builtFrom(app({ type: "service" }), "acme/web")).toBe(false);
});

test("a command's resource: a uuid, a name, Project/name, or the names it could be", () => {
	const places = new Map<number, Place>([
		[1, { project: "Conduish", projectUuid: "p1", environment: "production" }],
		[2, { project: "SQL Studio", projectUuid: "p2", environment: "production" }],
	]);
	const list = [app({ uuid: "a1", name: "server", environment_id: 1 }), app({ uuid: "a2", name: "server", environment_id: 2 }), app({ uuid: "rk1", name: "website:main-rk1", environment_id: 1 })];
	expect(find(list, "a2", places).uuid).toBe("a2");
	expect(find(list, "conduish/server", places).uuid).toBe("a1");
	expect(find(list, "SQL Studio/production/server", places).uuid).toBe("a2");
	expect(find(list, "website:main", places).uuid).toBe("rk1");
	expect(displayName(list[2]!)).toBe("website:main");
	expect(() => find(list, "server", places)).toThrow("Conduish/server (a1), SQL Studio/server (a2)");
});

test("Coolify's times, and --json without secrets", () => {
	expect(parseTime("2026-10-30T19:21:04.000000Z")).toBe(Date.UTC(2026, 9, 30, 19, 21, 4));
	expect(parseTime("2026-10-31 20:44:59")).toBe(Date.UTC(2026, 9, 31, 20, 44, 59));
	expect(Number.isNaN(parseTime(""))).toBe(true);
	const out = withoutSecrets({ name: "web", fqdn: "https://web.example.com", http_basic_auth_password: "pw", manual_webhook_secret_github: "s", docker_compose_raw: "x", git_repository: "acme/web" });
	expect(Object.keys(out).sort()).toEqual(["fqdn", "git_repository", "name"]);
});

test("a pasted .env: comments, export, quotes over lines, and back again", () => {
	const vars = parseDotenv(['# a comment', "export NODE_ENV=production", 'DATABASE_URL="postgres://u:p@db/x" # the db', "EMPTY=", "KEY='literal $HOME'", 'CERT="-----BEGIN-----', "abc", '-----END-----"', "NODE_ENV=staging", "not a line"].join("\n"));
	expect(vars).toEqual([
		{ key: "DATABASE_URL", value: "postgres://u:p@db/x" },
		{ key: "EMPTY", value: "" },
		{ key: "KEY", value: "literal $HOME" },
		{ key: "CERT", value: "-----BEGIN-----\nabc\n-----END-----" },
		{ key: "NODE_ENV", value: "staging" },
	]);
	expect(parseDotenv(toDotenv(vars))).toEqual(vars);
});
