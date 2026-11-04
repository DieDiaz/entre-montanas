// Menú transcrito del PDF "Menú ambas sucursales" de Entre Montañas.
// Precios en quetzales. Este archivo solo se usa para poblar la base de datos la primera vez;
// después los precios y la disponibilidad se editan desde el panel del personal.
//
// Campos opcionales de cada platillo:
//   variants: [{ label, price }]                 -> el cliente elige una (tamaño, sabor, proteína)
//   choose:   { label, count, options: [..] }    -> el cliente reparte `count` elecciones (guarniciones)
//   addons:   [{ label, price }]                 -> extras opcionales con costo

const GUARNICIONES = ['Guacamole', 'Papa asada', 'Papas al romero', 'Papas fritas', 'Frijoles volteados'];
const guarn = (n) => ({ label: `Elige ${n} guarniciones`, count: n, options: GUARNICIONES });
const CHORIZO_LONGANIZA = [{ label: 'Con chorizo' }, { label: 'Con longaniza' }];
const EXTRAS_POSTRE = [
  { label: 'Nutella', price: 10 }, { label: 'Crema batida', price: 10 }, { label: 'Helado', price: 12 },
  { label: 'Galleta Oreo', price: 10 }, { label: "m&m's", price: 10 }, { label: "Hershey's", price: 5 },
];
const copaPichel = (copa, pichel, soda = true) => {
  const v = [{ label: 'Copa', price: copa }, { label: 'Pichel', price: pichel }];
  if (soda) v.splice(1, 0, { label: 'Copa con soda', price: copa + 5 }), v.push({ label: 'Pichel con soda', price: pichel + 15 });
  return v;
};
const copaBotella = (copa, botella) => [{ label: 'Copa', price: copa }, { label: 'Botella', price: botella }];
const shotDobleBotella = (s, d, b) => [{ label: 'Shot', price: s }, { label: 'Doble', price: d }, { label: 'Botella', price: b }];

module.exports = [
  {
    id: 'desayunos', name: 'Desayunos', service: 'desayuno',
    note: 'Todos incluyen café y jugo · Servimos de 7:30 a 12:00',
    items: [
      { id: 'des-casa', name: 'De la Casa', price: 95, img: 'desayuno-de-la-casa', featured: true },
      { id: 'des-montana', name: 'De la Montaña', price: 80, img: 'desayuno-de-la-montana',
        desc: 'Carne, huevos, plátanos, frijol, tortillas con queso.' },
      { id: 'des-omelette', name: 'Omelette', price: 65, img: 'omelette',
        desc: 'Relleno de longaniza o chorizo y queso mozzarella.', variants: CHORIZO_LONGANIZA.map(v => ({ ...v, price: 65 })) },
      { id: 'des-chilaquiles', name: 'Chilaquiles de la Montaña', price: 65, img: 'chilaquiles',
        desc: 'Deliciosos nachos con salsa roja, longaniza, aguacate y huevo.' },
      { id: 'des-tradicional', name: 'Tradicional', price: 60, img: 'tradicional',
        desc: 'Huevos, plátanos, longaniza, frijol, tortilla con queso.' },
      { id: 'des-tacos', name: 'Tacos Montañosos', price: 55, img: 'tacos-montanosos',
        desc: '3 tacos de espinaca y queso, con huevos revueltos, en salsa de la casa.' },
      { id: 'des-nutritivo', name: 'Desayuno Nutritivo', price: 55, img: 'desayuno-nutritivo',
        desc: 'Yogurt natural con fruta, granola, pan tostado con jalea.' },
      { id: 'des-americano', name: 'Americano', price: 55, img: 'americano',
        desc: 'Huevo, tocino, panqueque, miel de maple.' },
      { id: 'des-torre', name: 'Torre de Panqueques', price: 45, img: 'torre-panqueques',
        desc: '3 panqueques con crema batida, bañados de chocolate Hershey, caramelo y Oreo.' },
      { id: 'des-clasico', name: 'Clásico', price: 45, img: 'clasico',
        desc: 'Huevo, frijoles, plátano y salsa natural.' },
      { id: 'des-panquequero', name: 'Panquequero', price: 35, img: 'panquequero',
        desc: 'Panqueques con fruta.' },
    ],
  },
  {
    id: 'entradas', name: 'Entradas',
    items: [
      { id: 'ent-picada', name: 'Picada de Chorizo o Longaniza', price: 60,
        desc: 'Acompañada de guacamole y frijol.', variants: [{ label: 'Chorizo', price: 60 }, { label: 'Longaniza', price: 60 }] },
      { id: 'ent-nachos', name: 'Nachos de la Casa', price: 55,
        desc: 'Pico de gallo, salsa, tocino y guacamole.' },
      { id: 'ent-tortillas', name: 'Tortillas con Queso Mozzarella', price: 55, img: 'tortillas-queso',
        desc: 'Con chorizo o longaniza, salsa de la casa y cebollín.', variants: CHORIZO_LONGANIZA.map(v => ({ ...v, price: 55 })) },
      { id: 'ent-papas-montana', name: 'Papas de la Montaña', price: 45,
        desc: 'Queso cheddar, cebollín, tomate y longaniza.' },
      { id: 'ent-papas', name: 'Papas Fritas', price: 35, desc: 'Con aderezo ranch.' },
    ],
  },
  {
    id: 'burgers', name: 'Burger Montañas', note: 'Todas incluyen papas fritas y gaseosa',
    items: [
      { id: 'bur-montana', name: 'De la Montaña', price: 90, img: 'burger-montana', featured: true,
        desc: 'Doble carne angus, queso fundido, tocino, cebolla caramelizada y aguacate.' },
      { id: 'bur-gourmet', name: 'Gourmet', price: 75, desc: 'Carne angus y camarones con salsa de la casa.' },
      { id: 'bur-hawaiana', name: 'Hawaiana', price: 70, desc: 'Carne angus, piña, lechuga, queso mozzarella y aderezo.' },
      { id: 'bur-bacon', name: 'Bacon', price: 60, desc: 'Carne angus, tocino, queso.' },
      { id: 'bur-torinoso', name: 'Toriñoso', price: 55, desc: 'Carne angus, huevo, lechuga, aderezo ranch.' },
      { id: 'bur-clasica', name: 'Clásica', price: 40, desc: 'Carne de res, lechuga, tomate, queso.' },
    ],
  },
  {
    id: 'asados', name: 'Asados', note: 'Incluyen 2 guarniciones a elección, chirmol y cebollín',
    items: [
      { id: 'asa-lomito', name: 'Lomito o Puyazo', price: 125, img: 'lomito', choose: guarn(2),
        variants: [
          { label: 'Lomito 8 oz', price: 125 }, { label: 'Lomito 12 oz', price: 200 },
          { label: 'Puyazo 8 oz', price: 125 }, { label: 'Puyazo 12 oz', price: 200 },
        ] },
      { id: 'asa-costilla', name: 'Costilla de Cerdo', price: 100, img: 'costilla', choose: guarn(2) },
      { id: 'asa-churrasquito', name: 'Churrasquito', price: 90, img: 'churrasquito', choose: guarn(2) },
      { id: 'asa-pollo', name: 'Pollo Asado', price: 75, img: 'pollo-asado', choose: guarn(2) },
    ],
  },
  {
    id: 'parrilladas', name: 'Parrilladas', note: 'Para compartir',
    items: [
      { id: 'par-amt', name: 'Aire, Mar y Tierra', price: 260, img: 'aire-mar-tierra', featured: true, choose: guarn(2),
        desc: 'Pollo a la parrilla, 4 camarones jumbo, 8 oz de lomito o puyazo, cebollín más 2 guarniciones.',
        variants: [{ label: 'Con lomito', price: 260 }, { label: 'Con puyazo', price: 260 }] },
      { id: 'par-2', name: 'Parrillada para 2', price: 265, choose: guarn(2),
        desc: '8 oz de lomito o puyazo, 8 oz de filete de pollo, 4 oz de adobado, 2 longanizas o chorizos más 2 guarniciones.' },
      { id: 'par-4', name: 'Parrillada para 4', price: 430, choose: guarn(4),
        desc: '16 oz de lomito o puyazo, 16 oz de filete de pollo, 8 oz de adobado, 4 longanizas o chorizos más 4 guarniciones.' },
      { id: 'par-6', name: 'Parrillada para 6', price: 690, choose: guarn(6),
        desc: '1½ lb de lomito o puyazo, 1½ lb de filete de pollo, 16 oz de adobado, 6 longanizas o chorizos más 6 guarniciones. Incluye tortillas.' },
      { id: 'par-8', name: 'Parrillada para 8', price: 890, choose: guarn(8),
        desc: '2 lb de lomito o puyazo, 2 lb de filete de pollo, 1½ lb de adobado, 8 longanizas o chorizos, 12 oz de costilla, más 8 guarniciones. Incluye pichel de fresco.' },
    ],
  },
  {
    id: 'mariscos', name: 'Del Mar',
    items: [
      { id: 'mar-mar-tierra', name: 'Mar y Tierra', price: 230, img: 'mar-y-tierra',
        desc: 'Camarón, 8 oz de lomito o puyazo más cebollín, chirmol, guacamole y papas fritas.',
        variants: [{ label: 'Con lomito', price: 230 }, { label: 'Con puyazo', price: 230 }] },
      { id: 'mar-caldo', name: 'Caldo de Mariscos', price: 160, img: 'caldo-mariscos' },
      { id: 'mar-ajillo', name: 'Camarones al Ajillo', price: 120, img: 'camarones-ajillo', desc: 'Acompañados de papas fritas y guacamol.' },
      { id: 'mar-empanizados', name: 'Camarones Empanizados', price: 110, img: 'camarones-empanizados', desc: 'Acompañados de papas fritas y guacamol.' },
      { id: 'mar-ceviche', name: 'Ceviche', price: 95, img: 'ceviche',
        variants: [
          { label: 'Camarón', price: 95 }, { label: 'Pulpo', price: 95 }, { label: 'Cangrejo', price: 95 }, { label: 'Mixto', price: 130 },
        ] },
      { id: 'mar-mojarra', name: 'Mojarra Frita', price: 90, img: 'mojarra', desc: 'Acompañada de papas fritas y guacamol.' },
    ],
  },
  {
    id: 'guarniciones', name: 'Guarniciones y extras',
    items: [
      ...GUARNICIONES.map((g, i) => ({ id: `gua-${i + 1}`, name: g, price: 15 })),
      { id: 'ext-tortilla', name: 'Tortilla', price: 15 },
      { id: 'ext-pan-ajo', name: 'Pan con ajo', price: 15 },
      { id: 'ext-pan-mantequilla', name: 'Pan con mantequilla', price: 15 },
      { id: 'ext-longaniza', name: 'Longaniza o chorizo', price: 15, variants: [{ label: 'Longaniza', price: 15 }, { label: 'Chorizo', price: 15 }] },
    ],
  },
  {
    id: 'postres', name: 'Crepas y postres',
    items: [
      { id: 'cre-manzana', name: 'Crepa al Vino con Manzanas Flameadas', price: 35, img: 'crepas', featured: true,
        desc: 'Recomendación de la casa.', addons: EXTRAS_POSTRE },
      { id: 'cre-melocoton', name: 'Crepa de Melocotón con Crema Batida', price: 30, addons: EXTRAS_POSTRE },
      { id: 'cre-nutella', name: 'Crepa de Nutella', price: 25, addons: EXTRAS_POSTRE,
        variants: [{ label: 'Banano', price: 25 }, { label: 'Fresa', price: 25 }, { label: 'Banano y fresa', price: 30 }] },
      { id: 'cre-pollo', name: 'Crepa Salada de Pollo Hawaiano', price: 40 },
      { id: 'pos-cheesecake', name: 'Cheesecake', price: 35, addons: EXTRAS_POSTRE },
      { id: 'pos-copa-helado', name: 'Copa de Helado', price: 30, addons: EXTRAS_POSTRE },
    ],
  },
  {
    id: 'bebidas', name: 'Bebidas',
    items: [
      { id: 'beb-limonada', name: 'Limonada', price: 25, img: 'limonada', variants: copaPichel(25, 50) },
      { id: 'beb-naranjada', name: 'Naranjada', price: 25, img: 'naranjada', variants: copaPichel(25, 50) },
      { id: 'beb-jamaica', name: 'Rosa de Jamaica', price: 25, variants: copaPichel(25, 50) },
      { id: 'beb-horchata', name: 'Horchata', price: 40, img: 'horchata',
        variants: [
          { label: 'Almendra · Copa', price: 40 }, { label: 'Almendra · Pichel', price: 70 },
          { label: 'Mazapán · Copa', price: 40 }, { label: 'Mazapán · Pichel', price: 70 },
        ] },
      { id: 'beb-gaseosa', name: 'Gaseosa', price: 15 },
      { id: 'beb-mineral', name: 'Mineral lata', price: 15 },
      { id: 'beb-agua', name: 'Botella de agua', price: 10 },
      { id: 'beb-frappe', name: 'Frappé', price: 25,
        variants: [
          { label: 'Fresa', price: 25 }, { label: 'Caramelo', price: 25 }, { label: 'Banano y chocolate', price: 25 },
          { label: 'Oreo', price: 30 }, { label: 'Nutella', price: 30 },
        ] },
      { id: 'beb-milkshake', name: 'Milkshake', price: 35,
        variants: [
          { label: 'Vainilla', price: 35 }, { label: 'Chocolate', price: 35 }, { label: 'Fresa', price: 35 },
          { label: 'De la casa (almendra)', price: 50 },
        ] },
    ],
  },
  {
    id: 'calientes', name: 'Bebidas calientes',
    items: [
      { id: 'cal-cafe', name: 'Café', price: 15 },
      { id: 'cal-capuchino', name: 'Capuchino', price: 30, variants: [{ label: 'Vainilla', price: 30 }, { label: 'Almendra', price: 30 }] },
      { id: 'cal-chocolate', name: 'Chocolate', price: 20 },
      { id: 'cal-te', name: 'Té', price: 15,
        variants: [{ label: 'Tilo', price: 15 }, { label: 'Manzanilla', price: 15 }, { label: 'Verde', price: 15 }, { label: 'Rosa de Jamaica', price: 15 }] },
    ],
  },
  {
    id: 'cocteleria', name: 'Coctelería y cervezas',
    items: [
      { id: 'coc-montana', name: 'De la Montaña', price: 50, img: 'cocteles', featured: true },
      { id: 'coc-jaggerbull', name: 'Jaggerbull', price: 45 },
      { id: 'coc-mojito', name: 'Mojito', price: 40 },
      { id: 'coc-pina-colada', name: 'Piña colada', price: 40 },
      { id: 'coc-daikiri', name: 'Daikiri', price: 40 },
      { id: 'coc-frosty', name: 'Frosty Sky', price: 40 },
      { id: 'coc-mar-azul', name: 'Mar azul', price: 40 },
      { id: 'coc-sangria', name: 'Sangría', price: 40 },
      { id: 'coc-cuba', name: 'Cuba Libre', price: 35 },
      { id: 'coc-volcanic', name: 'Volcanic', price: 35 },
      { id: 'coc-bloody', name: 'Bloody Mary', price: 35 },
      { id: 'coc-vodka', name: 'Exotic Vodka', price: 35 },
      { id: 'coc-margarita', name: 'Margarita', price: 35 },
      { id: 'cer-cerveza', name: 'Cerveza', price: 30, desc: 'Nacionales y extranjeras. Pregunta por las disponibles.' },
      { id: 'moc-sodas', name: 'Soda italiana', price: 35, desc: 'Sin alcohol.',
        variants: [{ label: 'Mango', price: 35 }, { label: 'Fresa', price: 35 }, { label: 'Manzana verde', price: 35 }] },
      { id: 'moc-mineral', name: 'Mineral preparada', price: 30, desc: 'Sin alcohol.' },
      { id: 'moc-cimarrona', name: 'Cimarrona', price: 25, desc: 'Sin alcohol.' },
    ],
  },
  {
    id: 'vinos', name: 'Vinos',
    items: [
      { id: 'vin-casa', name: 'Carmenere Rosé (de la casa)', price: 35, img: 'vino', variants: copaBotella(35, 150) },
      { id: 'vin-barefoot-sb', name: 'Barefoot Sauvignon Blanc', price: 25, variants: copaBotella(25, 125) },
      { id: 'vin-varietal-sb', name: 'Varietal Sauvignon Blanc', price: 25, variants: copaBotella(25, 125) },
      { id: 'vin-moscato', name: 'Pink Moscato', price: 25, variants: copaBotella(25, 125) },
      { id: 'vin-merlot', name: 'Barefoot Merlot', price: 25, variants: copaBotella(25, 125) },
      { id: 'vin-carmenere', name: 'Varietal Carmenere', price: 25, variants: copaBotella(25, 125) },
      { id: 'vin-red-blend', name: 'Reserva Red Blend', price: 25, variants: copaBotella(25, 125) },
      { id: 'vin-cabernet', name: 'Reserva Cabernet Sauvignon', price: 35, variants: copaBotella(35, 150) },
      { id: 'vin-gran-reserva', name: 'Gran Reserva Carmenere', price: 40, variants: copaBotella(40, 190) },
    ],
  },
  {
    id: 'licores', name: 'Licores',
    items: [
      { id: 'lic-jw-black', name: 'Johnnie Walker Black Label', price: 50, variants: shotDobleBotella(50, 80, 550) },
      { id: 'lic-jw-red', name: 'Johnnie Walker Red Label', price: 35, variants: shotDobleBotella(35, 55, 350) },
      { id: 'lic-zacapa-xo', name: 'Ron Zacapa XO Gran Reserva', price: 75, variants: shotDobleBotella(75, 140, 2100) },
      { id: 'lic-zacapa-23', name: 'Ron Zacapa 23', price: 50, variants: shotDobleBotella(50, 80, 900) },
      { id: 'lic-tequila', name: 'Tequila 1800', price: 40, variants: shotDobleBotella(40, 70, 820) },
    ],
  },
];
