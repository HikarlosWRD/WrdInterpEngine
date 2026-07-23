# Extension integration — v1.1.0

Arquivos atualizados:

- `engine-manager.js`: worker persistente, pré-aquecimento e fallback.
- `preheat-ui.js`: barra visual do aquecimento.
- `example-panel-integration.js`: funções para preparar, interpolar e encerrar o worker.

Adicione antes de `</body>` no HTML da extensão:

```html
<script
  id="wrd-preheat-ui-loader"
  src="wrd-preheat-ui.js"
  data-engine-manager="engine/engine-manager.js">
</script>
```

O valor de `data-engine-manager` é relativo à localização de `preheat-ui.js`.

Configuração padrão:

- espera: 30 segundos;
- resolução: 1920 × 1080;
- Scale: 1;
- precisão: FP16;
- pausa entre etapas: 1200 ms;
- compilação MIOpen paralela: 1.
