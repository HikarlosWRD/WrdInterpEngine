# WrdInterpEngine

Motor GMFSS Fortuna integrado à extensão **WrdUtilities** no Adobe After Effects.

## Instalação pela extensão

A extensão consulta:

```text
https://raw.githubusercontent.com/HikarlosWRD/WrdInterpEngine/main/releases/release-manifest.json
```

Depois baixa o runtime da GitHub Release, valida o SHA-256, prepara Python
3.12 portátil, instala PyTorch 2.9.1 + ROCm 7.2.1 e instala em:

```text
%LOCALAPPDATA%\WrdUtilities\InterpEngine
```

## Runtime

- Versão: 1.0.1
- Plataforma: Windows x64
- GPU: AMD ROCm
- Tag: `interp-engine-v1.0.1`
- Asset: `WrdInterpEngine-runtime-win-amd-v1.0.1.zip`

Os arquivos de integração CEP ficam em `extension/`.
