# WrdInterpEngine

Motor de interpolação **GMFSS Fortuna** integrado à extensão **WrdUtilities** para Adobe After Effects.

## Versão atual

- Runtime: **1.1.0**
- Plataforma: Windows x64
- GPU: AMD ROCm
- PyTorch: 2.9.1 + ROCm 7.2.1
- Python portátil: 3.12.10
- Release tag: `interp-engine-v1.1.0`
- Asset: `WrdInterpEngine-runtime-win-amd-v1.1.0.zip`

## Novidades da versão 1.1.0

### Worker persistente

O processo Python e o modelo GMFSS permanecem carregados enquanto o After Effects estiver aberto. Isso evita repetir a inicialização pesada do ROCm em cada clipe.

Em teste Full HD, x16 e 10 pares:

- primeira execução: aproximadamente 84 segundos;
- execução seguinte no mesmo worker: aproximadamente 28 segundos;
- aceleração observada: cerca de 3×.

### Pré-aquecimento automático

A extensão:

1. carrega o modelo na GPU;
2. aguarda 30 segundos;
3. pré-aquece Full HD, Scale 1 e FP16;
4. mostra uma barra de progresso;
5. pausa o aquecimento quando uma interpolação real começa.

O pré-aquecimento usa prioridade baixa, apenas uma compilação MIOpen por vez e pausas entre as etapas.

### Segurança para AMD e x32

- pré-aquecimento dividido em etapas menores;
- validação do contexto ROCm e dos tensores;
- x32 dividido em rajadas menores;
- x32 e saídas acima de 500 FPS usam `libx264`, evitando disputa entre ROCm e encoder AMD;
- arquivos bloqueados pelo After Effects geram uma mensagem clara;
- fallback executado em UTF-8.

## Instalação pela extensão

A extensão consulta:

```text
https://raw.githubusercontent.com/HikarlosWRD/WrdInterpEngine/main/releases/release-manifest.json
```

O instalador baixa o runtime, valida o SHA-256 e instala em:

```text
%LOCALAPPDATA%\WrdUtilities\InterpEngine
```

## Integração da barra de aquecimento

Copie `extension/preheat-ui.js` para o pacote CEP e carregue-o antes de `</body>`:

```html
<script
  id="wrd-preheat-ui-loader"
  src="wrd-preheat-ui.js"
  data-engine-manager="engine/engine-manager.js">
</script>
```

Ajuste `data-engine-manager` conforme a estrutura da extensão.

## Estrutura principal

```text
extension/
  engine-manager.js
  example-panel-integration.js
  install-engine.ps1
  preheat-ui.js

releases/
  release-manifest.json
```

Os pesos e arquivos do GMFSS ficam no asset da GitHub Release, não no histórico Git.
