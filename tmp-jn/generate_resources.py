from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter
import math, json, wave, struct, subprocess, random

ROOT = Path(__file__).parent / "src/main/resources/assets/jujutsu_neon"
TEX = ROOT / "textures/particle/vfx"
SOUNDS = ROOT / "sounds"
PART = ROOT / "particles"
ITEM = ROOT / "textures/item"
ARMOR = ROOT / "textures/models/armor"
MODEL = ROOT / "models/item"
LANG = ROOT / "lang"

for p in [TEX, SOUNDS, PART, ITEM, ARMOR, MODEL, LANG]:
    p.mkdir(parents=True, exist_ok=True)

# Primary techniques are rendered natively at 4096x4096.
# We deliberately keep one 4K sheet per major technique instead of dozens of
# 4K animation frames: this preserves detail while avoiding multi-gigabyte VRAM use.
CORE_4K = {
    "blue": {
        "main": (20, 175, 255),
        "accent": (125, 235, 255),
        "deep": (4, 24, 110),
        "style": "vortex"
    },
    "max_blue": {
        "main": (15, 120, 255),
        "accent": (100, 230, 255),
        "deep": (2, 8, 55),
        "style": "singularity"
    },
    "red": {
        "main": (255, 24, 48),
        "accent": (255, 120, 135),
        "deep": (80, 0, 6),
        "style": "repulsion"
    },
    "max_red": {
        "main": (255, 10, 35),
        "accent": (255, 90, 110),
        "deep": (60, 0, 4),
        "style": "cataclysm"
    },
    "hollow_purple": {
        "main": (165, 30, 255),
        "accent": (255, 65, 210),
        "deep": (38, 2, 75),
        "style": "void"
    }
}

GENERIC = {
    "cursed_barrage": (225, 40, 125),
    "infinity": (85, 210, 255),
    "domain": (130, 45, 255),
    "rct": (55, 255, 175),
    "teleport": (80, 175, 255),
    "dash": (60, 220, 255),
    "shockwave": (100, 225, 255),
    "star": (225, 90, 255),
    "slash": (245, 70, 255),
    "trail": (100, 205, 255)
}

def save_particle_json(name):
    (PART / f"vfx_{name}.json").write_text(
        json.dumps({"textures": [f"jujutsu_neon:vfx/{name}"]}, indent=2)
    )

def alpha_composite_blur(base, layer, radius):
    if radius > 0:
        layer = layer.filter(ImageFilter.GaussianBlur(radius))
    base.alpha_composite(layer)

def rotated_orbit(size, center, rx, ry, angle_deg, width, color, blur=0):
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    box = (
        center - rx, center - ry,
        center + rx, center + ry
    )
    d.ellipse(box, outline=color, width=width)
    if blur:
        layer = layer.filter(ImageFilter.GaussianBlur(blur))
    return layer.rotate(angle_deg, resample=Image.Resampling.BICUBIC, center=(center, center))

def draw_lightning(draw, rng, c, start_r, end_r, color, width, branches=1):
    angle = rng.uniform(0, math.tau)
    points = []
    steps = 12
    for i in range(steps + 1):
        t = i / steps
        r = start_r + (end_r - start_r) * t
        jitter = rng.uniform(-0.11, 0.11) * (1.0 - 0.45 * t)
        a = angle + jitter
        x = c + math.cos(a) * r + rng.uniform(-18, 18)
        y = c + math.sin(a) * r + rng.uniform(-18, 18)
        points.append((x, y))
    draw.line(points, fill=color, width=width, joint="curve")

    for _ in range(branches):
        bi = rng.randint(3, steps - 2)
        bx, by = points[bi]
        ba = angle + rng.uniform(-1.0, 1.0)
        bl = rng.uniform(150, 430)
        branch = [(bx, by)]
        for j in range(1, 6):
            t = j / 5
            branch.append((
                bx + math.cos(ba) * bl * t + rng.uniform(-25, 25),
                by + math.sin(ba) * bl * t + rng.uniform(-25, 25)
            ))
        draw.line(branch, fill=color, width=max(3, width // 2), joint="curve")

def make_core_4k(name, cfg):
    S = 4096
    C = S // 2
    rng = random.Random(0x4B1A + sum(ord(ch) for ch in name) * 97)
    main = cfg["main"]
    accent = cfg["accent"]
    deep = cfg["deep"]
    style = cfg["style"]

    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))

    # Wide atmospheric halo.
    halo = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    hd = ImageDraw.Draw(halo)
    for r, alpha, width in [
        (1770, 18, 240),
        (1580, 28, 170),
        (1410, 50, 105),
        (1260, 85, 60)
    ]:
        hd.ellipse((C-r, C-r, C+r, C+r), outline=(*main, alpha), width=width)
    alpha_composite_blur(im, halo, 70)

    # Deep body and luminous shell.
    body = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    bd = ImageDraw.Draw(body)
    bd.ellipse((760, 760, S-760, S-760), fill=(*deep, 235))
    for r, color, width in [
        (1320, (*main, 115), 120),
        (1210, (*accent, 170), 72),
        (1110, (255, 255, 255, 120), 22)
    ]:
        bd.ellipse((C-r, C-r, C+r, C+r), outline=color, width=width)
    im.alpha_composite(body)

    # Native-4K swirl filaments: thousands of pixels of real vector detail,
    # not a 1024 texture stretched four times.
    filaments = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    fd = ImageDraw.Draw(filaments)
    arm_count = 9 if style in {"singularity", "void"} else 7
    for arm in range(arm_count):
        pts = []
        phase = arm * math.tau / arm_count
        for i in range(180):
            t = i / 179.0
            radius = 120 + t * 1210
            turns = 2.6 if style == "vortex" else 3.2
            if style == "cataclysm":
                turns = 2.1
            a = phase + t * math.tau * turns + 0.18 * math.sin(t * math.pi * 5 + arm)
            squash = 0.93 + 0.07 * math.sin(arm)
            x = C + math.cos(a) * radius
            y = C + math.sin(a) * radius * squash
            pts.append((x, y))

        glow_color = (*main, 110)
        core_color = (245, 250, 255, 220) if arm % 3 == 0 else (*accent, 205)
        fd.line(pts, fill=glow_color, width=42, joint="curve")
        fd.line(pts, fill=core_color, width=10, joint="curve")
    alpha_composite_blur(im, filaments, 10)
    im.alpha_composite(filaments)

    # Multi-plane orbital rings for a genuinely volumetric look.
    for idx, angle in enumerate((-28, -8, 17, 39)):
        orbit_glow = rotated_orbit(
            S, C,
            int(1540 - idx * 95),
            int(560 + idx * 105),
            angle,
            34,
            (*main, 105),
            blur=18
        )
        im.alpha_composite(orbit_glow)
        orbit_core = rotated_orbit(
            S, C,
            int(1540 - idx * 95),
            int(560 + idx * 105),
            angle,
            10,
            (245, 250, 255, 220) if idx % 2 == 0 else (*accent, 220),
            blur=0
        )
        im.alpha_composite(orbit_core)

    # Lightning / spatial cracks.
    lightning_glow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    lg = ImageDraw.Draw(lightning_glow)
    bolt_count = 24 if style in {"cataclysm", "void"} else 17
    for i in range(bolt_count):
        draw_lightning(
            lg, rng, C,
            rng.uniform(180, 620),
            rng.uniform(1080, 1710),
            (*main, 110),
            rng.randint(18, 30),
            branches=2 if i % 4 == 0 else 1
        )
    alpha_composite_blur(im, lightning_glow, 16)

    lightning_core = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    lcd = ImageDraw.Draw(lightning_core)
    rng2 = random.Random(0xCAFE + sum(ord(ch) for ch in name))
    for i in range(max(10, bolt_count // 2)):
        draw_lightning(
            lcd, rng2, C,
            rng2.uniform(240, 700),
            rng2.uniform(1100, 1660),
            (255, 245, 255, 225) if name == "hollow_purple" else (*accent, 230),
            rng2.randint(5, 10),
            branches=1
        )
    im.alpha_composite(lightning_core)

    # Hundreds of micro-sparks and shards: detail that remains crisp when viewed close.
    sparks = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    sd = ImageDraw.Draw(sparks)
    spark_count = 520 if style in {"singularity", "cataclysm", "void"} else 360
    for i in range(spark_count):
        a = rng.uniform(0, math.tau)
        r = rng.uniform(760, 1860)
        x = C + math.cos(a) * r
        y = C + math.sin(a) * r
        rr = rng.randint(3, 15)
        color = (255, 255, 255, rng.randint(125, 235)) if i % 5 == 0 else (*accent, rng.randint(90, 205))
        sd.ellipse((x-rr, y-rr, x+rr, y+rr), fill=color)

    if style in {"singularity", "cataclysm", "void"}:
        for i in range(90):
            a = rng.uniform(0, math.tau)
            r = rng.uniform(1250, 1900)
            x = C + math.cos(a) * r
            y = C + math.sin(a) * r
            sz = rng.randint(14, 55)
            pts = [
                (x, y-sz),
                (x+sz*0.75, y+sz*0.5),
                (x-sz*0.65, y+sz*0.65)
            ]
            shard = (18, 8, 35, rng.randint(125, 210)) if name == "hollow_purple" else (*deep, rng.randint(150, 220))
            sd.polygon(pts, fill=shard)

    alpha_composite_blur(im, sparks, 2)
    im.alpha_composite(sparks)

    # Technique-specific center treatment.
    center_layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    cd = ImageDraw.Draw(center_layer)

    if style == "singularity":
        cd.ellipse((C-420, C-420, C+420, C+420), fill=(0, 3, 18, 245))
        for rr, alpha in [(520, 210), (430, 235), (340, 250)]:
            cd.ellipse((C-rr, C-rr, C+rr, C+rr), outline=(*accent, alpha), width=26)
    elif style == "void":
        cd.ellipse((C-520, C-520, C+520, C+520), fill=(28, 0, 58, 225))
        cd.ellipse((C-300, C-300, C+300, C+300), fill=(245, 220, 255, 210))
        cd.ellipse((C-145, C-145, C+145, C+145), fill=(255, 255, 255, 250))
    else:
        cd.ellipse((C-260, C-260, C+260, C+260), fill=(*main, 155))
        cd.ellipse((C-110, C-110, C+110, C+110), fill=(255, 255, 255, 245))

    alpha_composite_blur(im, center_layer, 30)
    im.alpha_composite(center_layer)

    # Preserve transparent margins for particle atlas bleeding.
    im.save(TEX / f"{name}.png", optimize=True, compress_level=9)
    save_particle_json(name)

def make_generic_vfx(name, rgb):
    # Generic supporting effects remain 4K output but are cheaper to generate.
    # Major techniques above are the native-detail textures.
    base = 1024
    c = base // 2
    im = Image.new("RGBA", (base, base), (0, 0, 0, 0))

    glow = Image.new("RGBA", (base, base), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    for width, alpha in [(150, 18), (90, 35), (48, 70), (18, 180)]:
        gd.ellipse((150, 150, base-150, base-150), outline=(*rgb, alpha), width=width)
    for i in range(16):
        a = math.tau * i / 16
        gd.line((
            c + math.cos(a) * 260,
            c + math.sin(a) * 260,
            c + math.cos(a) * 470,
            c + math.sin(a) * 470
        ), fill=(*rgb, 100), width=14)

    glow = glow.filter(ImageFilter.GaussianBlur(18))
    im.alpha_composite(glow)

    d = ImageDraw.Draw(im)
    d.ellipse((170, 170, base-170, base-170), outline=(245, 250, 255, 235), width=10)
    d.ellipse((225, 225, base-225, base-225), outline=(*rgb, 220), width=12)

    if name in {"slash", "trail", "cursed_barrage"}:
        d.arc((90, 230, base-90, base-130), 205, 345, fill=(255, 255, 255, 245), width=22)
        d.arc((130, 270, base-130, base-90), 195, 330, fill=(*rgb, 225), width=16)

    if name in {"star"}:
        for i in range(12):
            a = math.tau * i / 12
            rr = 455 if i % 2 == 0 else 340
            d.line((c, c, c + math.cos(a) * rr, c + math.sin(a) * rr), fill=(255, 255, 255, 220), width=8)

    im.resize((4096, 4096), Image.Resampling.LANCZOS).save(
        TEX / f"{name}.png",
        optimize=True,
        compress_level=9
    )
    save_particle_json(name)

for name, cfg in CORE_4K.items():
    print(f"Rendering native 4K technique VFX: {name}")
    make_core_4k(name, cfg)

for name, rgb in GENERIC.items():
    make_generic_vfx(name, rgb)

# 4K item texture.
s = 1024
im = Image.new("RGBA", (s, s), (0, 0, 0, 0))
d = ImageDraw.Draw(im)
d.rounded_rectangle((80, 340, 944, 690), radius=120, fill=(10, 12, 20, 255), outline=(60, 195, 255, 255), width=10)
for y in range(370, 670, 18):
    d.line((120, y, 900, y+12), fill=(34, 38, 52, 160), width=4)
d.rounded_rectangle((150, 405, 874, 625), radius=90, fill=(4, 5, 10, 255))
gl = Image.new("RGBA", (s, s), (0, 0, 0, 0))
g = ImageDraw.Draw(gl)
g.rounded_rectangle((130, 385, 894, 645), radius=105, outline=(55, 205, 255, 120), width=28)
gl = gl.filter(ImageFilter.GaussianBlur(25))
im.alpha_composite(gl)
im.resize((4096, 4096), Image.Resampling.LANCZOS).save(ITEM / "gojo_blindfold.png", optimize=True)

# Armor layer.
armor = Image.new("RGBA", (1024, 512), (0, 0, 0, 0))
ad = ImageDraw.Draw(armor)
ad.rectangle((0, 0, 255, 127), fill=(10, 12, 20, 255))
for y in range(12, 120, 12):
    ad.line((8, y, 246, y+4), fill=(45, 55, 72, 145), width=3)
armor.resize((4096, 2048), Image.Resampling.LANCZOS).save(ARMOR / "gojo_layer_1.png", optimize=True)

MODEL.joinpath("gojo_blindfold.json").write_text(json.dumps({
    "parent": "minecraft:item/generated",
    "textures": {"layer0": "jujutsu_neon:item/gojo_blindfold"}
}, indent=2))

LANG.joinpath("ru_ru.json").write_text(json.dumps({
    "item.jujutsu_neon.gojo_blindfold": "Повязка Годжо"
}, ensure_ascii=False, indent=2))

# Original synthesized HD sound design, 48 kHz stereo.
sound_names = [
    "blue", "max_blue", "red", "hollow_purple", "cursed_barrage",
    "domain", "infinity", "rct", "teleport", "dash"
]
sound_json = {n: {"sounds": [f"jujutsu_neon:{n}"]} for n in sound_names}
ROOT.joinpath("sounds.json").write_text(json.dumps(sound_json, indent=2))

sr = 48000
freqs = {
    "blue": 190, "max_blue": 120, "red": 95, "hollow_purple": 72,
    "cursed_barrage": 155, "domain": 48, "infinity": 310,
    "rct": 440, "teleport": 260, "dash": 520
}

for n in sound_names:
    dur = 1.15 if n in {"domain", "hollow_purple", "max_blue"} else 0.55
    count = int(sr * dur)
    wav = SOUNDS / f"{n}.wav"

    with wave.open(str(wav), "w") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(sr)

        frames = bytearray()
        f = freqs[n]

        for i in range(count):
            t = i / sr
            env = min(1.0, t / 0.025) * max(0.0, 1.0 - t / dur)
            sweep = f * (1.0 + 0.75 * t / dur)
            x = (
                math.sin(math.tau * sweep * t) * 0.52 +
                math.sin(math.tau * (sweep * 2.01) * t) * 0.22 +
                math.sin(math.tau * (sweep * 0.49) * t) * 0.16
            )
            transient = (
                (1.0 if i < sr * 0.018 else 0.0) *
                math.sin(math.tau * 1700 * t) * 0.35
            )
            sample = max(-1.0, min(1.0, (x + transient) * env))
            val = int(sample * 28000)
            frames += struct.pack("<hh", val, val)

        w.writeframes(frames)

    ogg = SOUNDS / f"{n}.ogg"
    subprocess.check_call([
        "ffmpeg", "-loglevel", "error", "-y",
        "-i", str(wav),
        "-c:a", "libvorbis", "-q:a", "7",
        str(ogg)
    ])
    wav.unlink()

print("Generated Jujutsu Neon native-4K technique resources")
