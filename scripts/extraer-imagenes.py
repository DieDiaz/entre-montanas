"""Recorta las fotos del menú y de la cabaña desde los PDFs originales.

Uso:  python scripts/extraer-imagenes.py <menu.pdf> <cabana.pdf>
Las coordenadas de MENU están en píxeles de una página renderizada a 595px de ancho.
"""
import sys, os, fitz

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "img")

MENU = {  # pagina: {archivo: (x0, y0, x1, y1)}
    1:  {"desayuno-de-la-casa": (40, 265, 560, 640)},
    2:  {"omelette": (60, 212, 272, 345), "tacos-montanosos": (310, 208, 560, 370),
         "tradicional": (55, 432, 248, 585), "desayuno-nutritivo": (338, 432, 532, 585),
         "torre-panqueques": (75, 652, 268, 800), "chilaquiles": (360, 655, 522, 790)},
    3:  {"americano": (0, 95, 595, 650)},
    4:  {"desayuno-de-la-montana": (0, 140, 595, 620)},
    5:  {"panquequero": (70, 200, 262, 360), "clasico": (330, 200, 532, 352),
         "tortillas-queso": (20, 655, 580, 810)},
    6:  {"naranjada": (10, 530, 175, 760), "horchata": (230, 530, 385, 760),
         "limonada": (440, 530, 590, 760)},
    7:  {"crepas": (0, 0, 595, 300)},
    10: {"burger-montana": (0, 300, 595, 650)},
    11: {"aire-mar-tierra": (0, 120, 595, 575)},
    12: {"pollo-asado": (40, 180, 262, 325), "lomito": (365, 180, 548, 335),
         "costilla": (55, 390, 252, 540), "churrasquito": (350, 372, 545, 520)},
    13: {"caldo-mariscos": (40, 170, 278, 318), "mar-y-tierra": (318, 170, 540, 322),
         "ceviche": (45, 410, 258, 565), "camarones-ajillo": (300, 410, 578, 540),
         "mojarra": (30, 620, 290, 790), "camarones-empanizados": (318, 620, 585, 780)},
    16: {"cocteles": (45, 478, 550, 758)},
    17: {"vino": (400, 190, 560, 500)},
}

CABANA = {  # pagina: {archivo: rect en puntos PDF}
    1: {"hero": (0, 0, 595.5, 222), "vista": (230, 0, 595.5, 210)},
    2: {"comedor": (310, 404, 554, 552), "sala": (37, 573, 282, 722)},
}

def crop(doc, pages, outdir, scale_px):
    os.makedirs(outdir, exist_ok=True)
    for pno, items in pages.items():
        page = doc[pno - 1]
        k = page.rect.width / scale_px if scale_px else 1
        for name, (x0, y0, x1, y1) in items.items():
            clip = fitz.Rect(x0 * k, y0 * k, x1 * k, y1 * k) & page.rect
            pix = page.get_pixmap(dpi=150, clip=clip)
            path = os.path.join(outdir, name + ".jpg")
            pix.save(path, jpg_quality=80)
            print(path, pix.width, "x", pix.height)

if __name__ == "__main__":
    crop(fitz.open(sys.argv[1]), MENU, os.path.join(ROOT, "menu"), 595)
    crop(fitz.open(sys.argv[2]), CABANA, os.path.join(ROOT, "cabana"), None)
