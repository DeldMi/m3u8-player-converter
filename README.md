# M3U8 Player + Converter

Aplicação web local para:

- reproduzir URLs `.m3u8` em tela grande;
- adicionar vários links a uma fila;
- continuar adicionando links enquanto outro vídeo está sendo processado;
- baixar/converter M3U8 para MP4 usando FFmpeg;
- mostrar progresso;
- disponibilizar o MP4 automaticamente quando terminar;
- usar HLS.js para reprodução no navegador.

## Requisitos

- Node.js 18 ou superior
- FFmpeg instalado e disponível no `PATH`

### Ubuntu / WSL

```bash
sudo apt update
sudo apt install -y ffmpeg
```

### Windows

Instale o FFmpeg e coloque a pasta `bin` no PATH do Windows.

## Instalação

```bash
npm install
npm start
```

Depois abra:

http://localhost:3000

## Como funciona

O navegador reproduz o M3U8 diretamente com HLS.js.

Ao clicar em **Adicionar**, o servidor coloca o link na fila. O FFmpeg tenta primeiro fazer **remux** (copiar os codecs sem recodificar). Se isso não funcionar, ele tenta transcodificar para H.264 + AAC.

Os arquivos concluídos ficam na pasta:

`downloads/`

## Observações importantes

1. Alguns servidores M3U8 exigem cookies, Referer, User-Agent ou autenticação. Esta versão não implementa esses cabeçalhos.
2. Alguns streams são protegidos por DRM; nesses casos o FFmpeg não deve ser usado para contornar a proteção.
3. Para publicar esta aplicação na internet, adicione autenticação e uma política de URLs permitidas. Aceitar URLs arbitrárias em um servidor público pode criar risco de SSRF.
4. O player no navegador pode funcionar mesmo quando o FFmpeg não consegue acessar o mesmo stream, por diferenças de CORS, headers ou autenticação.
