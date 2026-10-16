// hashads.io na Cloudflare: site mínimo da Hash Ads LLC (página inicial + documentos legais).
// Antes dos arquivos: http → https e www → domínio sem www. O resto são os arquivos de public/
// (endereço que não existe → 404.html).
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.protocol === "http:" || url.hostname.startsWith("www.")) {
      url.protocol = "https:";
      url.hostname = url.hostname.replace(/^www\./, "");
      return Response.redirect(url.toString(), 301);
    }
    return env.ASSETS.fetch(request);
  },
};
