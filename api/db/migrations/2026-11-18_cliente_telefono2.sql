-- Segundo teléfono del cliente (se piden dos números de contacto).
ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS "ClienteTelefono2" character varying(20) DEFAULT ''::character varying NOT NULL;

-- El sistema anterior guardaba los dos números pegados en ClienteTelefono
-- (ej. '09945848330976376105'). Se separan solo los casos sin ambigüedad:
-- exactamente dos celulares de 10 dígitos que empiezan con 09. El resto
-- (largos raros, posibles errores de tipeo) queda como está para revisar a mano.
UPDATE public.clientes
SET "ClienteTelefono2" = substr("ClienteTelefono", 11, 10),
    "ClienteTelefono"  = substr("ClienteTelefono", 1, 10)
WHERE "ClienteTelefono" ~ '^09[0-9]{8}09[0-9]{8}$'
  AND "ClienteTelefono2" = '';
