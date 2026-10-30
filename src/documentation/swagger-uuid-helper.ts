/** Browser-only convenience; never submits requests or changes Swagger inputs. */
export const SWAGGER_UUID_HELPER_SCRIPT = String.raw`
(() => {
  const root = document.getElementById('swagger-ui');
  if (!root || document.getElementById('swagger-uuid-helper')) return;

  const panel = document.createElement('section');
  panel.id = 'swagger-uuid-helper';
  panel.className = 'swagger-ui';
  panel.setAttribute('aria-label', 'Generador de Idempotency-Key');

  const title = document.createElement('h2');
  title.textContent = 'Idempotency-Key';
  const help = document.createElement('p');
  help.textContent = 'Genera un UUID solo para una operación nueva. Para reenviar la misma orden, conserva la clave original.';
  const controls = document.createElement('div');
  controls.className = 'uuid-controls';
  const label = document.createElement('label');
  label.htmlFor = 'swagger-order-uuid';
  label.textContent = 'UUID';
  const value = document.createElement('input');
  value.id = 'swagger-order-uuid';
  value.type = 'text';
  value.readOnly = true;
  value.placeholder = 'Pulsa Generar UUID';
  value.spellcheck = false;
  const generate = document.createElement('button');
  generate.type = 'button';
  generate.className = 'btn';
  generate.textContent = 'Generar UUID';
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'btn';
  copy.textContent = 'Copiar';
  copy.disabled = true;
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  generate.addEventListener('click', () => {
    try {
      value.value = crypto.randomUUID();
      copy.disabled = false;
      status.textContent = 'UUID generado. Cópialo y pégalo en el campo Idempotency-Key de la orden.';
    } catch {
      status.textContent = 'No se pudo generar el UUID. Usa un navegador con crypto.randomUUID y un contexto seguro (HTTPS o localhost).';
    }
  });
  copy.addEventListener('click', async () => {
    if (!value.value) return;
    const uuid = value.value;
    try {
      await navigator.clipboard.writeText(uuid);
      if (value.value === uuid) status.textContent = 'UUID copiado.';
    } catch {
      value.focus();
      value.select();
      status.textContent = 'No se pudo acceder al portapapeles. Copia el UUID seleccionado con Ctrl+C o Cmd+C.';
    }
  });

  controls.append(label, value, generate, copy);
  panel.append(title, help, controls, status);
  // A sibling survives Swagger's React rendering without observing its DOM.
  root.before(panel);
})();
`;

export const SWAGGER_UUID_HELPER_CSS = `
#swagger-uuid-helper {
  box-sizing: border-box;
  max-width: 1460px;
  margin: 16px auto;
  padding: 16px 20px;
  border: 1px solid #d8dde3;
  border-radius: 4px;
  background: #fff;
}
#swagger-uuid-helper h2 { margin: 0 0 8px; font-size: 18px; }
#swagger-uuid-helper p { margin: 8px 0; font-size: 14px; }
#swagger-uuid-helper .uuid-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
#swagger-uuid-helper input { width: 350px; max-width: 100%; box-sizing: border-box; font-family: monospace; }
#swagger-uuid-helper button:disabled { opacity: 0.5; cursor: default; }
`;
