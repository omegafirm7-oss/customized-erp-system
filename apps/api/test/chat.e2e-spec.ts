import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createTestApp, getPrisma, setupUserWithCompany, uniqueEmail } from "./utils/test-app";

describe("Team chat (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  /** A company member whose role carries exactly the given permission keys; returns their token and user id. */
  async function addMember(companyId: string, permissionKeys: string[], fullName: string) {
    const prisma = getPrisma(app);
    const email = uniqueEmail("chat");
    const password = "SuperSecret123!";
    await request(app.getHttpServer()).post("/auth/register").send({ email, password, fullName }).expect(201);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const permissions = await prisma.permission.findMany({ where: { key: { in: permissionKeys } } });
    const role = await prisma.role.create({
      data: { companyId, name: `Chat-${Date.now()}-${Math.floor(Math.random() * 1000)}`, rolePermissions: { create: permissions.map((p) => ({ permissionId: p.id })) } },
    });
    await prisma.companyUser.create({ data: { userId: user.id, companyId, roleId: role.id, status: "ACTIVE", isDefault: true } });
    const token = (await request(app.getHttpServer()).post("/auth/login").send({ email, password }).expect(201)).body.accessToken;
    return { token, userId: user.id };
  }

  async function setup() {
    const owner = await setupUserWithCompany(app); // Administrator, so holds chat.use
    const ownerUser = await getPrisma(app).user.findUniqueOrThrow({ where: { email: owner.email } });
    const bea = await addMember(owner.companyId, ["chat.use"], "Bea Berlin");
    const cai = await addMember(owner.companyId, ["chat.use"], "Cai Cairo");
    return { owner: { token: owner.accessToken, userId: ownerUser.id, companyId: owner.companyId }, bea, cai };
  }

  const get = (token: string, url: string) => request(app.getHttpServer()).get(url).set(auth(token));
  const post = (token: string, url: string) => request(app.getHttpServer()).post(url).set(auth(token));

  it("gives every company a #general channel, tracks unread per person, and clears it when read", async () => {
    const { owner, bea } = await setup();

    const channels = (await get(owner.token, "/chat/channels").expect(200)).body;
    const general = channels.find((c: any) => c.name === "general");
    expect(general).toMatchObject({ kind: "CHANNEL", isPrivate: false });
    expect((await get(bea.token, "/chat/channels").expect(200)).body.find((c: any) => c.name === "general")).toBeTruthy();

    await post(owner.token, `/chat/channels/${general.id}/messages`).send({ body: "Hello team" }).expect(201);

    const beaChannels = (await get(bea.token, "/chat/channels").expect(200)).body;
    expect(beaChannels.find((c: any) => c.id === general.id).unread).toBe(1);
    expect((await get(bea.token, "/chat/unread").expect(200)).body.unread).toBe(1);
    // the sender never has their own message unread
    expect((await get(owner.token, "/chat/unread").expect(200)).body.unread).toBe(0);

    const msgs = (await get(bea.token, `/chat/channels/${general.id}/messages`).expect(200)).body;
    expect(msgs.messages).toHaveLength(1);
    expect(msgs.messages[0]).toMatchObject({ body: "Hello team", deleted: false });
    expect(msgs.messages[0].senderName).toBeTruthy();

    await post(bea.token, `/chat/channels/${general.id}/read`).expect(201);
    expect((await get(bea.token, "/chat/unread").expect(200)).body.unread).toBe(0);
  });

  it("polls only what changed, and shows deletions", async () => {
    const { owner, bea } = await setup();
    const general = (await get(owner.token, "/chat/channels").expect(200)).body.find((c: any) => c.name === "general");

    const first = (await post(owner.token, `/chat/channels/${general.id}/messages`).send({ body: "one" }).expect(201)).body;
    const after = first.updatedAt;
    await new Promise((r) => setTimeout(r, 20));
    const second = (await post(bea.token, `/chat/channels/${general.id}/messages`).send({ body: "two" }).expect(201)).body;

    const poll = (await get(owner.token, `/chat/channels/${general.id}/messages?changedAfter=${encodeURIComponent(after)}`).expect(200)).body;
    expect(poll.messages.map((m: any) => m.body)).toEqual(["two"]);

    // only the sender can delete; the removal shows up in the next poll
    await request(app.getHttpServer()).delete(`/chat/messages/${second.id}`).set(auth(owner.token)).expect(403);
    await new Promise((r) => setTimeout(r, 20));
    await request(app.getHttpServer()).delete(`/chat/messages/${second.id}`).set(auth(bea.token)).expect(200);
    const poll2 = (await get(owner.token, `/chat/channels/${general.id}/messages?changedAfter=${encodeURIComponent(second.updatedAt)}`).expect(200)).body;
    expect(poll2.messages).toHaveLength(1);
    expect(poll2.messages[0]).toMatchObject({ id: second.id, deleted: true, body: "" });
  });

  it("keeps direct messages and private channels to their members", async () => {
    const { owner, bea, cai } = await setup();

    const dm = (await post(owner.token, "/chat/direct").send({ userId: bea.userId }).expect(201)).body;
    const dmAgain = (await post(bea.token, "/chat/direct").send({ userId: owner.userId }).expect(201)).body;
    expect(dmAgain.id).toBe(dm.id); // one DM per pair, whoever starts it
    await post(owner.token, `/chat/channels/${dm.id}/messages`).send({ body: "private hello" }).expect(201);
    expect((await get(bea.token, `/chat/channels/${dm.id}/messages`).expect(200)).body.messages).toHaveLength(1);
    await get(cai.token, `/chat/channels/${dm.id}/messages`).expect(403);
    expect((await get(cai.token, "/chat/channels").expect(200)).body.find((c: any) => c.id === dm.id)).toBeUndefined();
    await post(owner.token, "/chat/direct").send({ userId: owner.userId }).expect(400);

    // the DM is titled after the other person
    const beaList = (await get(bea.token, "/chat/channels").expect(200)).body;
    expect(beaList.find((c: any) => c.id === dm.id)).toMatchObject({ kind: "DIRECT", otherUserId: owner.userId });

    const priv = (await post(owner.token, "/chat/channels").send({ name: "Leadership Team", isPrivate: true, memberUserIds: [bea.userId] }).expect(201)).body;
    expect(priv.name).toBe("leadership-team");
    await get(bea.token, `/chat/channels/${priv.id}/messages`).expect(200);
    await get(cai.token, `/chat/channels/${priv.id}/messages`).expect(403);
    await post(owner.token, `/chat/channels/${priv.id}/members`).send({ userIds: [cai.userId] }).expect(201);
    await get(cai.token, `/chat/channels/${priv.id}/messages`).expect(200);

    await post(owner.token, "/chat/channels").send({ name: "leadership-team" }).expect(409);
  });

  it("shares files between members, refuses runnable ones, and keeps other companies out", async () => {
    const { owner, bea } = await setup();
    const general = (await get(owner.token, "/chat/channels").expect(200)).body.find((c: any) => c.name === "general");

    const sent = (
      await post(owner.token, `/chat/channels/${general.id}/messages`)
        .field("body", "site plan attached")
        .attach("file", Buffer.from("%PDF-1.4 plan"), { filename: "site plan.pdf", contentType: "application/pdf" })
        .expect(201)
    ).body;
    expect(sent.attachment).toMatchObject({ filename: "site plan.pdf", mimeType: "application/pdf", size: 13 });

    const download = await get(bea.token, `/chat/attachments/${sent.attachment.id}`).buffer(true).expect(200);
    expect(download.headers["content-type"]).toContain("application/pdf");
    expect(download.headers["content-disposition"]).toContain("attachment");
    expect(download.body.toString()).toBe("%PDF-1.4 plan");

    await post(owner.token, `/chat/channels/${general.id}/messages`)
      .attach("file", Buffer.from("MZ"), { filename: "run-me.exe", contentType: "application/octet-stream" })
      .expect(400);
    await post(owner.token, `/chat/channels/${general.id}/messages`).send({ body: "   " }).expect(400);

    // a different company can't see this one's channels or files
    const outsider = await setupUserWithCompany(app);
    await get(outsider.accessToken, `/chat/channels/${general.id}/messages`).expect(404);
    await get(outsider.accessToken, `/chat/attachments/${sent.attachment.id}`).expect(404);
    expect((await get(outsider.accessToken, "/chat/channels").expect(200)).body.some((c: any) => c.id === general.id)).toBe(false);
  });

  it("lets an admin add a colleague by email with chat-only access, and nobody else", async () => {
    const { owner, bea } = await setup();
    const email = uniqueEmail("newbie");

    // a brand-new email needs a name so an account can be created
    await post(owner.token, "/chat/invite").send({ email }).expect(400);
    const invited = (await post(owner.token, "/chat/invite").send({ email, fullName: "Nora Newcomer" }).expect(201)).body;
    expect(invited).toMatchObject({ email, alreadyMember: false, existingAccount: false });
    expect(invited.tempPassword).toHaveLength(12);

    // she can sign in and use chat, but nothing else in the company
    const nora = (await request(app.getHttpServer()).post("/auth/login").send({ email, password: invited.tempPassword }).expect(201)).body.accessToken;
    expect((await get(nora, "/chat/channels").expect(200)).body.some((c: any) => c.name === "general")).toBe(true);
    await get(nora, "/partners").expect(403);
    expect((await get(owner.token, "/chat/people").expect(200)).body.some((p: any) => p.email === email)).toBe(true);

    // inviting the same address again just reports she is already in
    const again = (await post(owner.token, "/chat/invite").send({ email: email.toUpperCase() }).expect(201)).body;
    expect(again).toMatchObject({ alreadyMember: true, tempPassword: null });

    // someone who already has a Universa login elsewhere keeps it: no new password
    const other = await setupUserWithCompany(app);
    const existing = (await post(owner.token, "/chat/invite").send({ email: other.email }).expect(201)).body;
    expect(existing).toMatchObject({ existingAccount: true, alreadyMember: false, tempPassword: null });

    // only someone who can manage users may add people
    await post(bea.token, "/chat/invite").send({ email: uniqueEmail("x"), fullName: "Xavier Yu" }).expect(403);
  });

  it("only lets roles that hold chat.use in", async () => {
    const { owner } = await setup();
    const noChat = await addMember(owner.companyId, ["projects.project.view"], "Read Only");
    await get(noChat.token, "/chat/channels").expect(403);
    await get(noChat.token, "/chat/unread").expect(403);
  });
});
