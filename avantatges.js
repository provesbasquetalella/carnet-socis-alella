// Llistat d'establiments vinculats i ofertes. El club el pot editar a mà:
// afegeix, treu o canvia blocs i puja el fitxer a GitHub.
// IMPORTANT: ara són establiments i ofertes INVENTATS, d'exemple.
//   cat:     club | alimentacio | vi | salut | esport   (per als filtres)
//   valor:   el número gran del val (p. ex. "−20%", "GRATIS")  +  valorText: què cobreix
//   pack:    true  →  en lloc de "valor" es mostra preuAntic (ratllat) i preuNou
//   color:   color d'accent (#RRGGBB)  ·  tinta: "clara" si el text sobre el color ha de ser blanc
//   mono:    inicials del comerç (1-3 lletres)
window.AVANTATGES_EXEMPLE = true;
window.AVANTATGES_CONDICIONS = "Mostra el QR del carnet al comerç. Ofertes no acumulables.";
window.AVANTATGES = [
  {
    club: true, cat: "club", nom: "Club Bàsquet Alella", mono: "CBA", categoria: "El nostre club",
    valor: "−10%", valorText: "en activitats del club", color: "#F88018",
    oferta: "Descompte de soci en tot el que organitza el club",
    detalls: ["Tecnificacions", "Torneigs", "Equipament del club"]
  },
  {
    cat: "alimentacio", nom: "Xarcuteria Can Pernil", mono: "CP", categoria: "Alimentació", color: "#B8412F", tinta: "clara",
    pack: true, preuAntic: "29 €", preuNou: "24 €",
    oferta: "Pack Pernil de soci",
    detalls: ["400 g de pernil ibèric tallat a mà", "1 llonganissa de Vic", "1 pa de pagès"]
  },
  {
    cat: "alimentacio", nom: "Forn Cal Fornier", mono: "CF", categoria: "Alimentació", color: "#E8B64B",
    valor: "−20%", valorText: "pa, coques i brioixeria",
    oferta: "Esmorzar i berenar a preu de soci",
    detalls: ["De dilluns a divendres", "Excepte encàrrecs especials"]
  },
  {
    cat: "vi", nom: "Celler Vinya d’Alella", mono: "VA", categoria: "Vi i gastronomia", color: "#6E2B4A", tinta: "clara",
    pack: true, preuAntic: "38 €", preuNou: "29 €",
    oferta: "Pack Tast al celler",
    detalls: ["3 ampolles de vi d’Alella (blanc, rosat i negre)", "Visita i tast per a 2 persones", "Cal reservar abans"]
  },
  {
    cat: "salut", nom: "Fisioteràpia Alella Actiu", mono: "FA", categoria: "Salut i esport", color: "#1F7A70", tinta: "clara",
    valor: "GRATIS", valorText: "1a sessió de valoració",
    oferta: "Cuida’t abans que la lesió t’aturi",
    detalls: ["10% de descompte en bons de 5 sessions", "Especialistes en lesions esportives"]
  },
  {
    cat: "esport", nom: "Esports Vallès", mono: "EV", categoria: "Botiga d’esports", color: "#2F5DA8", tinta: "clara",
    valor: "−15%", valorText: "calçat i roba esportiva",
    oferta: "Equipa’t per a la nova temporada",
    detalls: ["Excepte productes ja rebaixats", "Compra en botiga"]
  }
];
