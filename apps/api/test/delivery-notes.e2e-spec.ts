import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createTestApp, createPartner, grantModules, setupUserWithCompany } from "./utils/test-app";

describe("Delivery notes (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function setup() {
    const ctx = await setupUserWithCompany(app);
    const accessToken = await grantModules(app, ctx, ["sales"]);
    const customer = await createPartner(app, accessToken, "CUSTOMER");
    const order = (
      await request(app.getHttpServer())
        .post("/ar/orders")
        .set(auth(accessToken))
        .send({
          businessPartnerId: customer.id,
          orderDate: new Date().toISOString(),
          lines: [
            { description: "Steel pipes", quantity: "10", unitPrice: "100" },
            { description: "Valves", quantity: "4", unitPrice: "50" },
          ],
        })
        .expect(201)
    ).body;
    return { accessToken, order, server: app.getHttpServer() };
  }

  it("numbers each note uniquely, tracks what is left to deliver, and locks a signed note", async () => {
    const { accessToken, order, server } = await setup();

    const first = (await request(server).post("/ar/delivery-notes").set(auth(accessToken)).send({ salesOrderId: order.id, deliveryDate: new Date().toISOString() }).expect(201)).body;
    expect(first.deliveryNumber).toMatch(/^DN-/);
    expect(first.status).toBe("DRAFT");
    expect(first.lines).toHaveLength(2);

    // Deliver part of the pipes now.
    const pipes = first.lines.find((l: any) => l.salesOrderLine.description === "Steel pipes");
    await request(server).post(`/ar/delivery-notes/${first.id}/lines/${pipes.id}`).set(auth(accessToken)).send({ quantity: "6" }).expect(201);
    // More than the order holds is refused.
    await request(server).post(`/ar/delivery-notes/${first.id}/lines/${pipes.id}`).set(auth(accessToken)).send({ quantity: "11" }).expect(400);

    await request(server).post(`/ar/delivery-notes/${first.id}/update`).set(auth(accessToken)).send({ vehicleNumber: "ABC 1234", driverName: "Khalid" }).expect(201);
    const dispatched = (await request(server).post(`/ar/delivery-notes/${first.id}/dispatch`).set(auth(accessToken)).expect(201)).body;
    expect(dispatched.status).toBe("DISPATCHED");
    // Quantities are locked once dispatched.
    await request(server).post(`/ar/delivery-notes/${first.id}/lines/${pipes.id}`).set(auth(accessToken)).send({ quantity: "5" }).expect(409);

    // A second note offers only what is left: 4 pipes (the valves are all on the first note).
    const second = (await request(server).post("/ar/delivery-notes").set(auth(accessToken)).send({ salesOrderId: order.id, deliveryDate: new Date().toISOString() }).expect(201)).body;
    expect(second.deliveryNumber).not.toBe(first.deliveryNumber);
    const qty = Object.fromEntries(second.lines.map((l: any) => [l.salesOrderLine.description, Number(l.quantity)]));
    expect(qty).toEqual({ "Steel pipes": 4 });

    // Cancelling the first frees its quantities again.
    await request(server).post(`/ar/delivery-notes/${first.id}/cancel`).set(auth(accessToken)).expect(201);
    const reloaded = (await request(server).get(`/ar/delivery-notes/${second.id}`).set(auth(accessToken)).expect(200)).body;
    const pipesLine = reloaded.lines.find((l: any) => l.salesOrderLine.description === "Steel pipes");
    expect(Number(pipesLine.deliveredElsewhere)).toBe(0);

    // Sign for the second: needs a receiver's name, and a delivered note can no longer be cancelled.
    await request(server).post(`/ar/delivery-notes/${second.id}/dispatch`).set(auth(accessToken)).expect(201);
    await request(server).post(`/ar/delivery-notes/${second.id}/delivered`).set(auth(accessToken)).send({ receivedByName: "  " }).expect(400);
    const delivered = (await request(server).post(`/ar/delivery-notes/${second.id}/delivered`).set(auth(accessToken)).send({ receivedByName: "Site foreman" }).expect(201)).body;
    expect(delivered.status).toBe("DELIVERED");
    expect(delivered.receivedByName).toBe("Site foreman");
    await request(server).post(`/ar/delivery-notes/${second.id}/cancel`).set(auth(accessToken)).expect(409);
  });
});
