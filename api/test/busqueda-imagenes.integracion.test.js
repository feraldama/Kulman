// Tests contra la base: búsqueda de clientes (dashboard y pantalla de
// Clientes), separación de teléfonos de la migración y miniaturas de
// productos. Usan los datos propios de crearEntorno y los borran al final.
const fs = require("fs");
const path = require("path");
const { describe, test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const sharp = require("sharp");

const { pool, llamar, crearEntorno } = require("./entorno");
const C = require("../controllers/alquiler.controller");
const PC = require("../controllers/producto.controller");
const Alquiler = require("../models/alquiler.model");
const Cliente = require("../models/cliente.model");

const saltear = process.env.SKIP_DB_TESTS === "1";

// Número aleatorio de n dígitos (para que los datos de prueba sean únicos)
const digitos = (n) =>
  Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join("");

// Llama a getProductoImagen y junta status, headers y cuerpo
function pedirImagen(id, { ancho, etag } = {}) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      headers: {},
      set(h) {
        Object.assign(this.headers, h);
        return this;
      },
      status(c) {
        this.statusCode = c;
        return this;
      },
      send(cuerpo) {
        resolve({ status: this.statusCode, headers: this.headers, cuerpo });
      },
      end() {
        resolve({ status: this.statusCode, headers: this.headers });
      },
      json(cuerpo) {
        resolve({ status: this.statusCode, headers: this.headers, cuerpo });
      },
    };
    PC.getProductoImagen(
      {
        params: { id: String(id) },
        query: ancho ? { ancho: String(ancho) } : {},
        headers: etag ? { "if-none-match": etag } : {},
      },
      res
    );
  });
}

const imagenDePrueba = (color, ancho = 2000, alto = 1000) =>
  sharp({ create: { width: ancho, height: alto, channels: 3, background: color } })
    .png()
    .toBuffer();

describe("búsqueda de clientes e imágenes (integración)", { skip: saltear }, () => {
  let e;
  const ci = digitos(7);
  const ruc = `${ci}-${digitos(1)}`;
  const telefono = `09${digitos(8)}`;
  const telefono2 = `09${digitos(8)}`;

  before(async () => {
    e = await crearEntorno({ stock: 2 });
    // Cliente con tilde, cédula y dos teléfonos; el apellido del entorno es
    // único y sirve para que la búsqueda no choque con datos reales
    await pool.query(
      `UPDATE clientes SET "ClienteNombre" = 'JOSÉ', "ClienteRUC" = $1,
         "ClienteTelefono" = $2, "ClienteTelefono2" = $3
       WHERE "ClienteId" = $4`,
      [ruc, telefono, telefono2, e.clienteId]
    );
    // Alquiler pendiente en 2040: fuera de cualquier rango "próximos N días"
    const r = await llamar(C.createAlquiler, {
      body: e.alquiler({ CajaId: e.cajaId, UsuarioId: e.usuarioId }),
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
  });
  after(async () => {
    await e?.limpiar();
    await pool.end();
  });

  describe("dashboard: alquileres próximos", () => {
    const apellido = () =>
      // el apellido del entorno es el sufijo único (en minúsculas)
      pool
        .query(`SELECT "ClienteApellido" FROM clientes WHERE "ClienteId" = $1`, [
          e.clienteId,
        ])
        .then((r) => r.rows[0].ClienteApellido);

    const buscar = async (controlador, q) =>
      (await llamar(controlador, { query: { dias: "7", q } })).body;

    test("sin búsqueda respeta el rango de fechas (no aparece el de 2040)", async () => {
      const body = await buscar(C.getAlquileresProximosEntrega, "");
      assert.ok(!body.data.some((a) => a.ClienteId === e.clienteId));
    });

    test("con búsqueda ignora las fechas y encuentra por nombre sin tilde", async () => {
      const ap = await apellido();
      for (const q of [`jose ${ap}`, `${ap} JOSÉ`]) {
        const body = await buscar(C.getAlquileresProximosEntrega, q);
        assert.equal(body.success, true);
        assert.deepEqual(
          body.data.map((a) => a.ClienteId),
          [e.clienteId],
          `búsqueda "${q}"`
        );
        assert.equal(body.recortada, false);
        assert.equal(body.data[0].ClienteRUC, ruc);
        assert.ok(Array.isArray(body.data[0].prendas));
      }
    });

    test("encuentra por cédula con puntos y por teléfono escrito por partes", async () => {
      const conPuntos = ci.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
      const tel2PorPartes = `${telefono2.slice(0, 4)} ${telefono2.slice(4, 7)}-${telefono2.slice(7)}`;
      for (const q of [conPuntos, ruc, telefono, tel2PorPartes]) {
        const entrega = await buscar(C.getAlquileresProximosEntrega, q);
        const devolucion = await buscar(C.getAlquileresProximosDevolucion, q);
        for (const body of [entrega, devolucion]) {
          assert.ok(
            body.data.some((a) => a.ClienteId === e.clienteId),
            `búsqueda "${q}"`
          );
        }
      }
    });

    test("recorta al límite y avisa cuando hay más resultados", async () => {
      const original = Alquiler.LIMITE_BUSQUEDA;
      Alquiler.LIMITE_BUSQUEDA = 0; // cualquier resultado ya supera el límite
      try {
        const body = await buscar(C.getAlquileresProximosEntrega, telefono);
        assert.equal(body.recortada, true);
        assert.equal(body.data.length, 0);
        assert.equal(body.limite, 0);
      } finally {
        Alquiler.LIMITE_BUSQUEDA = original;
      }
    });
  });

  describe("pantalla de Clientes", () => {
    test("busca por teléfono, cédula con puntos y nombre sin tilde", async () => {
      const conPuntos = ci.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
      for (const q of [telefono2, conPuntos, `jose ${ci}`]) {
        const { clientes, total } = await Cliente.search(q, 10, 0, "ClienteId", "ASC");
        assert.ok(
          clientes.some((c) => c.ClienteId === e.clienteId),
          `búsqueda "${q}"`
        );
        assert.ok(total >= 1);
      }
    });

    test("un número solo también encuentra por ID exacto", async () => {
      const { clientes } = await Cliente.search(
        String(e.clienteId),
        100,
        0,
        "ClienteId",
        "ASC"
      );
      assert.ok(clientes.some((c) => c.ClienteId === e.clienteId));
    });
  });

  describe("migración: separar teléfonos pegados", () => {
    test("separa solo dos celulares de 10 dígitos; el resto queda igual", async () => {
      const archivo = path.join(
        __dirname,
        "../db/migrations/2026-11-18_cliente_telefono2.sql"
      );
      const update = /UPDATE public\.clientes[\s\S]*?;/.exec(
        fs.readFileSync(archivo, "utf8")
      )[0];

      const casos = [
        // [teléfono original, teléfono esperado, teléfono 2 esperado]
        ["09811111110972222222", "0981111111", "0972222222"],
        ["0981111111097222222", "0981111111097222222", ""], // falta un dígito
        ["0981111111", "0981111111", ""],
        ["02112345670981111111", "02112345670981111111", ""], // fijo + celular
      ];

      // En una transacción que se descarta: no toca los datos reales
      const cx = await pool.connect();
      try {
        await cx.query("BEGIN");
        const ids = [];
        for (const [tel] of casos) {
          const r = await cx.query(
            `INSERT INTO clientes ("ClienteNombre", "ClienteTelefono", "UsuarioId")
             VALUES ('TEST MIGRACION', $1, $2) RETURNING "ClienteId"`,
            [tel, e.usuarioId]
          );
          ids.push(r.rows[0].ClienteId);
        }
        await cx.query(update);
        const { rows } = await cx.query(
          `SELECT "ClienteId", "ClienteTelefono", "ClienteTelefono2"
           FROM clientes WHERE "ClienteId" = ANY($1)`,
          [ids]
        );
        const porId = new Map(rows.map((r) => [r.ClienteId, r]));
        casos.forEach(([original, tel, tel2], i) => {
          const fila = porId.get(ids[i]);
          assert.equal(fila.ClienteTelefono, tel, `caso ${original}`);
          assert.equal(fila.ClienteTelefono2, tel2, `caso ${original}`);
        });
      } finally {
        await cx.query("ROLLBACK").catch(() => {});
        cx.release();
      }
    });
  });

  describe("miniaturas de productos", () => {
    test("producto sin imagen: 404", async () => {
      const r = await pedirImagen(e.productoId);
      assert.equal(r.status, 404);
    });

    test("devuelve JPEG reducido al ancho pedido, con ETag y 304", async () => {
      await pool.query(
        `UPDATE producto SET "ProductoImagen" = $1 WHERE "ProductoId" = $2`,
        [await imagenDePrueba("#ff0000"), e.productoId]
      );

      const r = await pedirImagen(e.productoId, { ancho: 160 });
      assert.equal(r.status, 200);
      assert.equal(r.headers["Content-Type"], "image/jpeg");
      assert.equal(r.headers["Cache-Control"], "private, no-cache");
      const meta = await sharp(r.cuerpo).metadata();
      assert.equal(meta.format, "jpeg");
      assert.equal(meta.width, 160); // 2000x1000 -> 160x80
      assert.equal(meta.height, 80);

      const otra = await pedirImagen(e.productoId, {
        ancho: 160,
        etag: r.headers.ETag,
      });
      assert.equal(otra.status, 304);
      assert.equal(otra.cuerpo, undefined);
    });

    test("al editar la foto se descarta la miniatura vieja", async () => {
      const antes = await pedirImagen(e.productoId, { ancho: 160 });
      const nueva = (await imagenDePrueba("#0000ff", 800, 800)).toString("base64");

      const r = await llamar(PC.updateProducto, {
        params: { id: String(e.productoId) },
        body: { ProductoNombre: "TEST FOTO NUEVA", ProductoImagen: nueva },
      });
      assert.equal(r.status, 200, JSON.stringify(r.body));

      const despues = await pedirImagen(e.productoId, { ancho: 160 });
      assert.equal(despues.status, 200);
      assert.notEqual(despues.headers.ETag, antes.headers.ETag);
      const meta = await sharp(despues.cuerpo).metadata();
      assert.equal(meta.width, 160);
      assert.equal(meta.height, 160);
    });

    test("editar sin mandar ProductoImagen conserva la foto", async () => {
      const antes = await pedirImagen(e.productoId, { ancho: 96 });
      const r = await llamar(PC.updateProducto, {
        params: { id: String(e.productoId) },
        body: { ProductoNombre: "TEST SIN TOCAR FOTO" },
      });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      const despues = await pedirImagen(e.productoId, { ancho: 96 });
      assert.equal(despues.status, 200);
      assert.equal(despues.headers.ETag, antes.headers.ETag);
    });

    test("al guardar, la API achica la foto a JPEG de hasta 1600 px", async () => {
      const grande = (await imagenDePrueba("#00aa00", 3200, 2400)).toString("base64");
      const r = await llamar(PC.updateProducto, {
        params: { id: String(e.productoId) },
        body: { ProductoNombre: "TEST FOTO GRANDE", ProductoImagen: grande },
      });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal("ProductoImagen" in r.body.data, false);

      const { rows } = await pool.query(
        `SELECT "ProductoImagen" FROM producto WHERE "ProductoId" = $1`,
        [e.productoId]
      );
      const meta = await sharp(rows[0].ProductoImagen).metadata();
      assert.equal(meta.format, "jpeg");
      assert.equal(meta.width, 1600);
      assert.equal(meta.height, 1200);
    });

    test("los listados de productos no traen la foto, solo TieneImagen", async () => {
      const r = await llamar(PC.getProductoById, {
        params: { id: String(e.productoId) },
      });
      assert.equal(r.status, 200);
      assert.equal(r.body.TieneImagen, true);
      assert.equal("ProductoImagen" in r.body, false);
    });
  });
});
