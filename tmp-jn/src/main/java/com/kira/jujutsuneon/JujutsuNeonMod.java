package com.kira.jujutsuneon;

import com.mojang.blaze3d.platform.InputConstants;
import com.mojang.blaze3d.vertex.PoseStack;
import com.mojang.math.Axis;
import net.minecraft.ChatFormatting;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.client.particle.Particle;
import net.minecraft.client.particle.ParticleProvider;
import net.minecraft.client.particle.ParticleRenderType;
import net.minecraft.client.particle.SpriteSet;
import net.minecraft.client.particle.TextureSheetParticle;
import net.minecraft.core.particles.DustParticleOptions;
import net.minecraft.core.particles.ParticleTypes;
import net.minecraft.core.particles.ParticleType;
import net.minecraft.core.particles.SimpleParticleType;
import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.sounds.SoundEvent;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.sounds.SoundSource;
import net.minecraft.util.Mth;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.effect.MobEffectInstance;
import net.minecraft.world.effect.MobEffects;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.item.ArmorItem;
import net.minecraft.world.item.ArmorMaterial;
import net.minecraft.world.item.CreativeModeTabs;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Rarity;
import net.minecraft.world.item.crafting.Ingredient;
import net.minecraft.world.phys.AABB;
import net.minecraft.world.phys.Vec3;
import net.minecraftforge.api.distmarker.Dist;
import net.minecraftforge.client.event.RegisterKeyMappingsEvent;
import net.minecraftforge.client.event.RegisterParticleProvidersEvent;
import net.minecraftforge.client.event.RenderHandEvent;
import net.minecraftforge.client.event.RenderGuiEvent;
import net.minecraftforge.event.BuildCreativeModeTabContentsEvent;
import net.minecraftforge.event.TickEvent;
import net.minecraftforge.event.entity.living.LivingAttackEvent;
import net.minecraftforge.eventbus.api.SubscribeEvent;
import net.minecraftforge.eventbus.api.IEventBus;
import net.minecraftforge.fml.common.Mod;
import net.minecraftforge.fml.DistExecutor;
import net.minecraftforge.fml.javafmlmod.FMLJavaModLoadingContext;
import net.minecraftforge.registries.DeferredRegister;
import net.minecraftforge.registries.ForgeRegistries;
import net.minecraftforge.registries.RegistryObject;
import net.minecraftforge.network.NetworkEvent;
import net.minecraftforge.network.PacketDistributor;
import net.minecraftforge.network.NetworkRegistry;
import net.minecraftforge.network.simple.SimpleChannel;
import org.joml.Vector3f;
import org.lwjgl.glfw.GLFW;

import java.util.Comparator;
import java.util.List;
import java.util.concurrent.ThreadLocalRandom;
import java.util.function.Supplier;

/**
 * Jujutsu Neon ULTIMATE — Forge 1.20.1.
 * Включает собственные 4K VFX-спрайты, HD-аудио и 4K-текстуры предметов.
 * VFX-пайплайн усилен многослойными shockwave/star/slash/trail эффектами
 * в яркой action-RPG эстетике, без копирования чужих ассетов.
 *
 * Повязка Годжо:
 * Пока она надета в слот головы, доступны техники и усиленное движение.
 *
 * Клавиши по умолчанию:
 * Q — дэш. Q = вперёд, A+Q = влево, D+Q = вправо
 * Left Ctrl — суперскорость; во время режима доступны 10 воздушных прыжков
 * Z — Blue; Z+ (удержание 1 сек) — Maximum Blue
 * X — Red; X+ — Hollow Purple
 * C — Black Flash; C+ — Cursed Barrage
 * V — Infinity ON/OFF; V+ — Domain Expansion
 * B — RCT/лечение; B+ — Limitless Blink
 *
 * H — показать/скрыть боковую панель техник.
 * Любой бинд можно переназначить прямо в Minecraft:
 * Настройки -> Управление -> Назначение клавиш -> Jujutsu Neon — способности.
 *
 * ВАЖНО:
 * 1) Файл должен лежать по пути:
 *    src/main/java/com/kira/jujutsuneon/JujutsuNeonMod.java
 *
 * 2) В META-INF/mods.toml modId должен быть:
 *    jujutsu_neon
 *
 * 3) Код рассчитан на Minecraft 1.20.1 + Forge 47.x.
 */
@Mod(JujutsuNeonMod.MODID)
public class JujutsuNeonMod {

    public static final String MODID = "jujutsu_neon";
    private static final String PROTOCOL = "5";

    private static final double CE_MAX = 100.0;

    private static final DeferredRegister<Item> ITEMS =
            DeferredRegister.create(ForgeRegistries.ITEMS, MODID);

    private static final DeferredRegister<SoundEvent> SOUNDS =
            DeferredRegister.create(ForgeRegistries.SOUND_EVENTS, MODID);

    private static final DeferredRegister<ParticleType<?>> PARTICLES =
            DeferredRegister.create(ForgeRegistries.PARTICLE_TYPES, MODID);

    private static RegistryObject<SimpleParticleType> particle(String name) {
        return PARTICLES.register(name, () -> new SimpleParticleType(true));
    }

    public static final RegistryObject<SimpleParticleType> VFX_BLUE = particle("vfx_blue");
    public static final RegistryObject<SimpleParticleType> VFX_MAX_BLUE = particle("vfx_max_blue");
    public static final RegistryObject<SimpleParticleType> VFX_RED = particle("vfx_red");
    public static final RegistryObject<SimpleParticleType> VFX_PURPLE = particle("vfx_hollow_purple");
    public static final RegistryObject<SimpleParticleType> VFX_BLACK_FLASH = particle("vfx_black_flash");
    public static final RegistryObject<SimpleParticleType> VFX_BARRAGE = particle("vfx_cursed_barrage");
    public static final RegistryObject<SimpleParticleType> VFX_INFINITY = particle("vfx_infinity");
    public static final RegistryObject<SimpleParticleType> VFX_DOMAIN = particle("vfx_domain");
    public static final RegistryObject<SimpleParticleType> VFX_RCT = particle("vfx_rct");
    public static final RegistryObject<SimpleParticleType> VFX_TELEPORT = particle("vfx_teleport");
    public static final RegistryObject<SimpleParticleType> VFX_DASH = particle("vfx_dash");

    // Layered anime/action VFX: shockwave, star-burst, slash and speed trail.
    public static final RegistryObject<SimpleParticleType> VFX_SHOCKWAVE = particle("vfx_shockwave");
    public static final RegistryObject<SimpleParticleType> VFX_STAR = particle("vfx_star");
    public static final RegistryObject<SimpleParticleType> VFX_SLASH = particle("vfx_slash");
    public static final RegistryObject<SimpleParticleType> VFX_TRAIL = particle("vfx_trail");

    private static RegistryObject<SoundEvent> sound(String name) {
        return SOUNDS.register(name, () -> SoundEvent.createVariableRangeEvent(new ResourceLocation(MODID, name)));
    }

    public static final RegistryObject<SoundEvent> SFX_BLUE = sound("blue");
    public static final RegistryObject<SoundEvent> SFX_MAX_BLUE = sound("max_blue");
    public static final RegistryObject<SoundEvent> SFX_RED = sound("red");
    public static final RegistryObject<SoundEvent> SFX_PURPLE = sound("hollow_purple");
    public static final RegistryObject<SoundEvent> SFX_BLACK_FLASH = sound("black_flash");
    public static final RegistryObject<SoundEvent> SFX_BARRAGE = sound("cursed_barrage");
    public static final RegistryObject<SoundEvent> SFX_DOMAIN = sound("domain");
    public static final RegistryObject<SoundEvent> SFX_INFINITY = sound("infinity");
    public static final RegistryObject<SoundEvent> SFX_RCT = sound("rct");
    public static final RegistryObject<SoundEvent> SFX_TELEPORT = sound("teleport");
    public static final RegistryObject<SoundEvent> SFX_DASH = sound("dash");

    public static final RegistryObject<Item> GOJO_BLINDFOLD = ITEMS.register(
            "gojo_blindfold",
            () -> new GojoBlindfoldItem(
                    GojoBlindfoldMaterial.INSTANCE,
                    ArmorItem.Type.HELMET,
                    new Item.Properties().stacksTo(1).rarity(Rarity.EPIC)
            )
    );

    private static final SimpleChannel NETWORK = NetworkRegistry.newSimpleChannel(
            new ResourceLocation(MODID, "main"),
            () -> PROTOCOL,
            PROTOCOL::equals,
            PROTOCOL::equals
    );

    private static int packetId = 0;

    public JujutsuNeonMod() {
        IEventBus modBus = FMLJavaModLoadingContext.get().getModEventBus();
        ITEMS.register(modBus);
        SOUNDS.register(modBus);
        PARTICLES.register(modBus);
        modBus.addListener(this::addToCreativeTab);

        NETWORK.registerMessage(
                packetId++,
                AbilityPacket.class,
                AbilityPacket::encode,
                AbilityPacket::decode,
                AbilityPacket::handle
        );

        NETWORK.registerMessage(
                packetId++,
                MovementPacket.class,
                MovementPacket::encode,
                MovementPacket::decode,
                MovementPacket::handle
        );

        NETWORK.registerMessage(
                packetId++,
                HudSyncPacket.class,
                HudSyncPacket::encode,
                HudSyncPacket::decode,
                HudSyncPacket::handle
        );
    }

    private void addToCreativeTab(BuildCreativeModeTabContentsEvent event) {
        if (event.getTabKey() == CreativeModeTabs.COMBAT) {
            event.accept(GOJO_BLINDFOLD);
        }
    }

    private enum Ability {
        BLUE,
        MAX_BLUE,
        RED,
        HOLLOW_PURPLE,
        BLACK_FLASH,
        CURSED_BARRAGE,
        INFINITY_TOGGLE,
        DOMAIN,
        RCT,
        TELEPORT
    }

    private enum MovementAction {
        FRONT_DASH,
        LEFT_DASH,
        RIGHT_DASH,
        EXTRA_JUMP,
        SPEED_ON,
        SPEED_OFF
    }

    private static boolean hasGojoBlindfold(ServerPlayer player) {
        return player.getItemBySlot(EquipmentSlot.HEAD).is(GOJO_BLINDFOLD.get());
    }

    private static void requireBlindfoldMessage(ServerPlayer player) {
        player.displayClientMessage(
                Component.literal("Надень Повязку Годжо, чтобы использовать технику.")
                        .withStyle(ChatFormatting.LIGHT_PURPLE),
                true
        );
    }

    private static double getEnergy(ServerPlayer player) {
        if (!player.getPersistentData().contains("jn_ce")) {
            player.getPersistentData().putDouble("jn_ce", CE_MAX);
        }
        return Mth.clamp(player.getPersistentData().getDouble("jn_ce"), 0.0, CE_MAX);
    }

    private static void setEnergy(ServerPlayer player, double value) {
        player.getPersistentData().putDouble("jn_ce", Mth.clamp(value, 0.0, CE_MAX));
    }

    private static boolean consumeEnergy(ServerPlayer player, double amount) {
        double current = getEnergy(player);
        if (current + 1.0E-6 < amount) {
            player.displayClientMessage(
                    Component.literal("Недостаточно проклятой энергии: нужно " + (int) Math.ceil(amount) + "%")
                            .withStyle(ChatFormatting.AQUA),
                    true
            );
            return false;
        }
        setEnergy(player, current - amount);
        return true;
    }

    private static double abilityCost(ServerPlayer player, Ability ability) {
        return switch (ability) {
            case BLUE -> 8.0;
            case MAX_BLUE -> 24.0;
            case RED -> 12.0;
            case HOLLOW_PURPLE -> 45.0;
            case BLACK_FLASH -> 6.0;
            case CURSED_BARRAGE -> 22.0;
            case INFINITY_TOGGLE -> player.getPersistentData().getBoolean("jn_infinity") ? 0.0 : 10.0;
            case DOMAIN -> 68.0;
            case RCT -> 30.0;
            case TELEPORT -> 18.0;
        };
    }

    private static void useAbility(ServerPlayer player, Ability ability) {
        if (player == null || !player.isAlive() || player.isSpectator()) return;

        if (!hasGojoBlindfold(player)) {
            requireBlindfoldMessage(player);
            return;
        }

        ServerLevel level = player.serverLevel();
        long now = level.getGameTime();
        String cooldownKey = "jn_cd_" + ability.name().toLowerCase();
        long cooldownUntil = player.getPersistentData().getLong(cooldownKey);

        if (now < cooldownUntil) {
            long ticksLeft = cooldownUntil - now;
            double seconds = Math.ceil(ticksLeft / 2.0) / 10.0;
            player.displayClientMessage(
                    Component.literal("Перезарядка: " + seconds + " сек.")
                            .withStyle(ChatFormatting.GRAY),
                    true
            );
            return;
        }

        double cost = abilityCost(player, ability);
        if (!consumeEnergy(player, cost)) return;

        switch (ability) {
            case BLUE -> { castBlue(player); setCooldown(player, ability, 100); }
            case MAX_BLUE -> { castMaxBlue(player); setCooldown(player, ability, 220); }
            case RED -> { castRed(player); setCooldown(player, ability, 140); }
            case HOLLOW_PURPLE -> { castHollowPurple(player); setCooldown(player, ability, 420); }
            case BLACK_FLASH -> { castBlackFlash(player); setCooldown(player, ability, 90); }
            case CURSED_BARRAGE -> { castCursedBarrage(player); setCooldown(player, ability, 180); }
            case INFINITY_TOGGLE -> { castInfinityToggle(player); setCooldown(player, ability, 20); }
            case DOMAIN -> { castDomain(player); setCooldown(player, ability, 600); }
            case RCT -> { castRCT(player); setCooldown(player, ability, 260); }
            case TELEPORT -> { castTeleport(player); setCooldown(player, ability, 120); }
        }
    }

    private static void setCooldown(ServerPlayer player, Ability ability, long ticks) {
        player.getPersistentData().putLong(
                "jn_cd_" + ability.name().toLowerCase(),
                player.level().getGameTime() + ticks
        );
    }

    private static void playSfx(ServerLevel level, ServerPlayer player, RegistryObject<SoundEvent> sfx, float volume, float pitch) {
        level.playSound(null, player.blockPosition(), sfx.get(), SoundSource.PLAYERS, volume, pitch);
    }

    private static void handSign(ServerPlayer player) {
        player.swing(InteractionHand.MAIN_HAND, true);
        player.swing(InteractionHand.OFF_HAND, true);
    }


    /**
     * Layered action-game VFX. These use only registered Forge particles,
     * so the effects remain multiplayer-safe and do not require shaders.
     */
    private static void playImpactLayer(ServerLevel level, Vec3 at, float volume, float pitch) {
        level.playSound(null, at.x, at.y, at.z,
                SoundEvents.GENERIC_EXPLODE, SoundSource.PLAYERS,
                volume, pitch);
        level.playSound(null, at.x, at.y, at.z,
                SoundEvents.FIREWORK_ROCKET_BLAST, SoundSource.PLAYERS,
                Math.max(0.25f, volume * 0.55f), Math.min(1.9f, pitch * 1.28f));
    }

    private static void playEnergyLayer(ServerLevel level, Vec3 at, float volume, float pitch) {
        level.playSound(null, at.x, at.y, at.z,
                SoundEvents.BEACON_ACTIVATE, SoundSource.PLAYERS,
                Math.max(0.2f, volume * 0.42f), Math.min(1.9f, pitch * 1.22f));
    }

    private static void spawnStylizedShockwave(
            ServerLevel level,
            Vec3 center,
            double radius,
            Vector3f color
    ) {
        // Big camera-facing ring sprite + concentric 3D rings.
        spawnVfx(level, VFX_SHOCKWAVE, center, 2);

        for (int layer = 0; layer < 3; layer++) {
            double r = radius * (0.70 + layer * 0.25);
            int points = 64 + layer * 16;

            for (int i = 0; i < points; i++) {
                double a = Math.PI * 2.0 * i / points;
                double x = center.x + Math.cos(a) * r;
                double z = center.z + Math.sin(a) * r;
                double y = center.y + Math.sin(a * 3.0) * 0.06 * (layer + 1);
                sendDust(level, new Vec3(x, y, z), color, 1.05f + layer * 0.22f);
            }
        }
    }

    private static void spawnRadialStar(
            ServerLevel level,
            Vec3 center,
            Vector3f colorA,
            Vector3f colorB,
            int rays,
            double length
    ) {
        spawnVfx(level, VFX_STAR, center, 2);

        for (int ray = 0; ray < rays; ray++) {
            double yaw = (Math.PI * 2.0 * ray / rays) + rnd(-0.12, 0.12);
            double rise = rnd(-0.35, 0.55);
            Vec3 dir = new Vec3(Math.cos(yaw), rise, Math.sin(yaw)).normalize();

            for (int p = 1; p <= 7; p++) {
                double d = length * p / 7.0;
                Vec3 pos = center.add(dir.scale(d));
                sendDust(level, pos, (ray + p) % 2 == 0 ? colorA : colorB,
                        1.20f - p * 0.06f);
            }
        }

        level.sendParticles(
                ParticleTypes.ELECTRIC_SPARK,
                center.x, center.y, center.z,
                26,
                length * 0.25, length * 0.18, length * 0.25,
                0.12
        );
    }

    private static void spawnEnergySpiral(
            ServerLevel level,
            Vec3 origin,
            Vec3 direction,
            double length,
            double radius,
            double turns,
            Vector3f colorA,
            Vector3f colorB
    ) {
        Vec3 forward = direction.normalize();
        Vec3 reference = Math.abs(forward.y) > 0.90
                ? new Vec3(1, 0, 0)
                : new Vec3(0, 1, 0);

        Vec3 right = forward.cross(reference).normalize();
        Vec3 up = right.cross(forward).normalize();

        int points = Math.max(36, (int) (length * 7.0));

        for (int i = 0; i <= points; i++) {
            double t = i / (double) points;
            double angle = t * turns * Math.PI * 2.0;
            double r = radius * (0.45 + 0.55 * Math.sin(Math.PI * t));

            Vec3 ringOffset = right.scale(Math.cos(angle) * r)
                    .add(up.scale(Math.sin(angle) * r));

            Vec3 p = origin.add(forward.scale(length * t)).add(ringOffset);
            sendDust(level, p, i % 2 == 0 ? colorA : colorB, 1.15f);

            if (i % 9 == 0) {
                spawnVfx(level, VFX_TRAIL, p, 1);
            }
        }
    }

    private static void spawnSlashFan(
            ServerLevel level,
            Vec3 center,
            Vector3f colorA,
            Vector3f colorB
    ) {
        spawnVfx(level, VFX_SLASH, center, 2);

        for (int slash = 0; slash < 5; slash++) {
            double baseAngle = -0.9 + slash * 0.45;
            for (int i = 0; i < 20; i++) {
                double t = i / 19.0;
                double r = 0.35 + t * 2.4;
                double a = baseAngle + (t - 0.5) * 0.65;
                Vec3 p = center.add(
                        Math.cos(a) * r,
                        (t - 0.5) * 1.3 + (slash - 2) * 0.12,
                        Math.sin(a) * r
                );
                sendDust(level, p, (slash + i) % 2 == 0 ? colorA : colorB, 1.15f);
            }
        }
    }

    private static void spawnDome(
            ServerLevel level,
            Vec3 center,
            double radius,
            Vector3f colorA,
            Vector3f colorB
    ) {
        // Sparse hemisphere lattice: looks large but keeps particle count sane.
        for (int lat = 1; lat <= 8; lat++) {
            double phi = (Math.PI / 2.0) * lat / 8.0;
            double ringRadius = Math.cos(phi) * radius;
            double y = Math.sin(phi) * radius;
            int points = 24 + lat * 4;

            for (int i = 0; i < points; i++) {
                double a = Math.PI * 2.0 * i / points;
                Vec3 p = center.add(Math.cos(a) * ringRadius, y, Math.sin(a) * ringRadius);
                if ((i + lat) % 2 == 0) {
                    sendDust(level, p, lat % 2 == 0 ? colorA : colorB, 0.95f);
                }
            }
        }
    }

    private static void castBlue(ServerPlayer player) {
        ServerLevel level = player.serverLevel();
        handSign(player);
        playSfx(level, player, SFX_BLUE, 1.15f, 1.0f);
        Vec3 look = player.getLookAngle().normalize();
        Vec3 center = player.getEyePosition().add(look.scale(7.0));
        spawnEnergySpiral(level, player.getEyePosition(), look, 7.0, 0.72, 2.8,
                new Vector3f(0.02f, 0.85f, 1.0f),
                new Vector3f(0.45f, 0.02f, 1.0f));
        spawnStylizedShockwave(level, center, 2.1, new Vector3f(0.03f, 0.75f, 1.0f));
        playEnergyLayer(level, center, 0.85f, 1.18f);
        spawnVfx(level, VFX_BLUE, center, 1);

        spawnNeonSphere(
                level,
                center,
                2.7,
                new Vector3f(0.05f, 0.75f, 1.0f),
                new Vector3f(0.55f, 0.05f, 1.0f)
        );

        AABB area = new AABB(center, center).inflate(5.0);
        List<LivingEntity> targets = level.getEntitiesOfClass(
                LivingEntity.class,
                area,
                e -> e.isAlive() && e != player
        );

        for (LivingEntity target : targets) {
            Vec3 delta = center.subtract(target.position());
            if (delta.lengthSqr() < 0.01) continue;

            Vec3 pull = delta.normalize().scale(0.95);
            target.setDeltaMovement(
                    target.getDeltaMovement().add(
                            pull.x,
                            Mth.clamp(pull.y + 0.10, -0.15, 0.55),
                            pull.z
                    )
            );
            target.hurtMarked = true;
            target.hurt(level.damageSources().playerAttack(player), 5.0F);
        }

        player.displayClientMessage(
                Component.literal("BLUE — притяжение").withStyle(ChatFormatting.AQUA),
                true
        );
    }

    private static void castMaxBlue(ServerPlayer player) {
        ServerLevel level = player.serverLevel();
        handSign(player);
        playSfx(level, player, SFX_MAX_BLUE, 1.35f, 0.82f);

        Vec3 look = player.getLookAngle().normalize();
        Vec3 center = player.getEyePosition().add(look.scale(10.0));
        spawnEnergySpiral(level, player.getEyePosition(), look, 10.0, 1.05, 4.2,
                new Vector3f(0.02f, 0.92f, 1.0f),
                new Vector3f(0.30f, 0.02f, 1.0f));
        spawnStylizedShockwave(level, center, 4.0, new Vector3f(0.02f, 0.78f, 1.0f));
        spawnRadialStar(level, center,
                new Vector3f(0.02f, 0.95f, 1.0f),
                new Vector3f(0.40f, 0.05f, 1.0f),
                18, 4.8);
        playEnergyLayer(level, center, 1.15f, 0.90f);
        spawnVfx(level, VFX_MAX_BLUE, center, 1);

        for (int r = 1; r <= 4; r++) {
            spawnNeonRing(level, center, r * 1.25, new Vector3f(0.02f, 0.65f, 1.0f));
        }
        spawnNeonSphere(level, center, 4.2,
                new Vector3f(0.02f, 0.85f, 1.0f),
                new Vector3f(0.35f, 0.02f, 1.0f));

        List<LivingEntity> targets = level.getEntitiesOfClass(
                LivingEntity.class,
                new AABB(center, center).inflate(9.0),
                e -> e.isAlive() && e != player
        );

        for (LivingEntity target : targets) {
            Vec3 delta = center.subtract(target.position());
            if (delta.lengthSqr() < 0.01) continue;
            double strength = Mth.clamp(1.65 - delta.length() * 0.05, 0.65, 1.65);
            Vec3 pull = delta.normalize().scale(strength);
            target.setDeltaMovement(target.getDeltaMovement().add(pull.x, pull.y * 0.45 + 0.18, pull.z));
            target.hurtMarked = true;
            target.hurt(level.damageSources().playerAttack(player), 10.0F);
        }

        player.displayClientMessage(
                Component.literal("MAXIMUM BLUE").withStyle(ChatFormatting.AQUA, ChatFormatting.BOLD),
                true
        );
    }

    private static void castHollowPurple(ServerPlayer player) {
        ServerLevel level = player.serverLevel();
        handSign(player);
        playSfx(level, player, SFX_PURPLE, 1.5f, 0.78f);

        Vec3 origin = player.getEyePosition();
        Vec3 dir = player.getLookAngle().normalize();
        double range = 28.0;
        spawnEnergySpiral(level, origin, dir, range, 1.25, 7.5,
                new Vector3f(0.60f, 0.00f, 1.0f),
                new Vector3f(1.00f, 0.04f, 0.52f));

        for (int step = 0; step < 84; step++) {
            double d = step * (range / 84.0);
            Vec3 p = origin.add(dir.scale(d));
            double pulse = 0.22 + 0.32 * Math.sin(step * 0.6);

            sendDust(level, p.add(rnd(-pulse, pulse), rnd(-pulse, pulse), rnd(-pulse, pulse)),
                    new Vector3f(0.58f, 0.0f, 1.0f), 1.7f);
            sendDust(level, p.add(rnd(-pulse, pulse), rnd(-pulse, pulse), rnd(-pulse, pulse)),
                    new Vector3f(1.0f, 0.05f, 0.58f), 1.4f);

            if (step % 4 == 0) {
                level.sendParticles(ParticleTypes.END_ROD, p.x, p.y, p.z, 2, 0.18, 0.18, 0.18, 0.02);
                level.sendParticles(ParticleTypes.ELECTRIC_SPARK, p.x, p.y, p.z, 3, 0.25, 0.25, 0.25, 0.12);
            }
        }

        Vec3 end = origin.add(dir.scale(range * 0.55));
        spawnStylizedShockwave(level, end, 5.0, new Vector3f(0.80f, 0.02f, 1.0f));
        spawnRadialStar(level, end,
                new Vector3f(0.72f, 0.00f, 1.0f),
                new Vector3f(1.00f, 0.03f, 0.42f),
                22, 6.0);
        playImpactLayer(level, end, 1.35f, 0.72f);
        spawnVfx(level, VFX_PURPLE, end, 2);
        AABB corridor = new AABB(origin, origin.add(dir.scale(range))).inflate(2.25);
        List<LivingEntity> targets = level.getEntitiesOfClass(
                LivingEntity.class,
                corridor,
                e -> e.isAlive() && e != player && isInFront(player, e, 0.72)
        );

        for (LivingEntity target : targets) {
            target.hurt(level.damageSources().playerAttack(player), 24.0F);
            Vec3 knock = dir.scale(2.4);
            target.setDeltaMovement(target.getDeltaMovement().add(knock.x, 0.35, knock.z));
            target.hurtMarked = true;
        }

        spawnNeonSphere(level, end, 2.2,
                new Vector3f(0.65f, 0.0f, 1.0f),
                new Vector3f(1.0f, 0.0f, 0.55f));

        player.displayClientMessage(
                Component.literal("HOLLOW PURPLE").withStyle(ChatFormatting.DARK_PURPLE, ChatFormatting.BOLD),
                true
        );
    }

    private static void castRed(ServerPlayer player) {
        ServerLevel level = player.serverLevel();
        handSign(player);
        playSfx(level, player, SFX_RED, 1.25f, 0.95f);
        Vec3 center = player.position().add(0, 1.0, 0);
        spawnStylizedShockwave(level, center, 5.6, new Vector3f(1.0f, 0.03f, 0.10f));
        spawnRadialStar(level, center,
                new Vector3f(1.0f, 0.02f, 0.08f),
                new Vector3f(1.0f, 0.36f, 0.02f),
                20, 5.5);
        playImpactLayer(level, center, 1.10f, 1.03f);
        spawnVfx(level, VFX_RED, center, 2);

        spawnNeonRing(
                level,
                center,
                6.0,
                new Vector3f(1.0f, 0.03f, 0.12f)
        );

        level.sendParticles(
                ParticleTypes.ELECTRIC_SPARK,
                center.x, center.y, center.z,
                70,
                1.0, 1.0, 1.0,
                0.35
        );

        List<LivingEntity> targets = level.getEntitiesOfClass(
                LivingEntity.class,
                player.getBoundingBox().inflate(6.5),
                e -> e.isAlive() && e != player
        );

        for (LivingEntity target : targets) {
            Vec3 away = target.position().subtract(player.position());
            if (away.lengthSqr() < 0.01) away = new Vec3(0.01, 0, 0);
            away = away.normalize();

            target.hurt(level.damageSources().playerAttack(player), 8.0F);
            target.setDeltaMovement(
                    target.getDeltaMovement().add(
                            away.x * 1.75,
                            0.55,
                            away.z * 1.75
                    )
            );
            target.hurtMarked = true;
        }

        player.displayClientMessage(
                Component.literal("RED — отталкивающий импульс").withStyle(ChatFormatting.RED),
                true
        );
    }

    private static void castBlackFlash(ServerPlayer player) {
        ServerLevel level = player.serverLevel();
        player.swing(InteractionHand.MAIN_HAND, true);
        playSfx(level, player, SFX_BLACK_FLASH, 1.35f, 0.9f);
        Vec3 look = player.getLookAngle().normalize();

        player.setDeltaMovement(
                player.getDeltaMovement().add(
                        look.x * 1.25,
                        0.10,
                        look.z * 1.25
                )
        );
        player.hurtMarked = true;

        AABB box = player.getBoundingBox().inflate(4.5);
        LivingEntity target = level.getEntitiesOfClass(
                        LivingEntity.class,
                        box,
                        e -> e.isAlive() && e != player && isInFront(player, e, 0.58)
                )
                .stream()
                .min(Comparator.comparingDouble(player::distanceToSqr))
                .orElse(null);

        Vec3 impact = player.getEyePosition().add(look.scale(2.1));

        if (target != null) {
            impact = target.position().add(0, target.getBbHeight() * 0.55, 0);
            spawnVfx(level, VFX_BLACK_FLASH, impact, 2);
            spawnStylizedShockwave(level, impact, 2.8, new Vector3f(0.70f, 0.00f, 1.0f));
            spawnRadialStar(level, impact,
                    new Vector3f(0.75f, 0.00f, 1.0f),
                    new Vector3f(1.00f, 0.02f, 0.08f),
                    14, 3.4);
            spawnSlashFan(level, impact,
                    new Vector3f(0.80f, 0.00f, 1.0f),
                    new Vector3f(1.00f, 0.02f, 0.12f));
            playImpactLayer(level, impact, 1.0f, 1.32f);
            target.hurt(level.damageSources().playerAttack(player), 14.0F);

            Vec3 knock = target.position().subtract(player.position()).normalize();
            target.setDeltaMovement(
                    target.getDeltaMovement().add(
                            knock.x * 0.85,
                            0.32,
                            knock.z * 0.85
                    )
            );
            target.hurtMarked = true;
        }

        for (int i = 0; i < 65; i++) {
            double ox = rnd(-0.75, 0.75);
            double oy = rnd(-0.75, 0.75);
            double oz = rnd(-0.75, 0.75);

            sendDust(
                    level,
                    impact.add(ox, oy, oz),
                    i % 2 == 0
                            ? new Vector3f(0.70f, 0.00f, 1.00f)
                            : new Vector3f(1.00f, 0.02f, 0.12f),
                    1.45f
            );
        }

        level.sendParticles(
                ParticleTypes.SMOKE,
                impact.x, impact.y, impact.z,
                35,
                0.55, 0.55, 0.55,
                0.09
        );

        level.sendParticles(
                ParticleTypes.ELECTRIC_SPARK,
                impact.x, impact.y, impact.z,
                45,
                0.45, 0.45, 0.45,
                0.28
        );

        if (target != null) {
            // FLOW: успешный Black Flash на 8 секунд усиливает реген энергии и мобильность.
            player.getPersistentData().putLong("jn_flow_until", level.getGameTime() + 160);
            setEnergy(player, getEnergy(player) + 12.0);
        }

        player.displayClientMessage(
                Component.literal(target != null ? "BLACK FLASH // FLOW" : "BLACK FLASH")
                        .withStyle(ChatFormatting.DARK_PURPLE, ChatFormatting.BOLD),
                true
        );
    }

    private static void castCursedBarrage(ServerPlayer player) {
        ServerLevel level = player.serverLevel();
        player.swing(InteractionHand.MAIN_HAND, true);
        playSfx(level, player, SFX_BARRAGE, 1.25f, 1.05f);

        LivingEntity target = level.getEntitiesOfClass(
                        LivingEntity.class,
                        player.getBoundingBox().inflate(6.0),
                        e -> e.isAlive() && e != player && isInFront(player, e, 0.55)
                )
                .stream()
                .min(Comparator.comparingDouble(player::distanceToSqr))
                .orElse(null);

        if (target != null) {
            Vec3 impact = target.position().add(0, target.getBbHeight() * 0.55, 0);
            spawnVfx(level, VFX_BARRAGE, impact, 3);
            for (int i = 0; i < 6; i++) {
                target.hurt(level.damageSources().playerAttack(player), 3.0F);
                for (int p = 0; p < 18; p++) {
                    sendDust(level,
                            impact.add(rnd(-0.75, 0.75), rnd(-0.8, 0.8), rnd(-0.75, 0.75)),
                            i % 2 == 0 ? new Vector3f(0.95f, 0.05f, 0.25f) : new Vector3f(0.55f, 0.0f, 1.0f),
                            1.25f);
                }
            }
            Vec3 knock = target.position().subtract(player.position()).normalize().scale(1.4);
            target.setDeltaMovement(target.getDeltaMovement().add(knock.x, 0.38, knock.z));
            target.hurtMarked = true;
        }

        player.displayClientMessage(
                Component.literal("CURSED BARRAGE").withStyle(ChatFormatting.RED, ChatFormatting.BOLD),
                true
        );
    }

    private static void castInfinityToggle(ServerPlayer player) {
        ServerLevel level = player.serverLevel();
        boolean enabled = !player.getPersistentData().getBoolean("jn_infinity");
        player.getPersistentData().putBoolean("jn_infinity", enabled);
        playSfx(level, player, SFX_INFINITY, 1.15f, enabled ? 1.08f : 0.82f);
        if (enabled) spawnVfx(level, VFX_INFINITY, player.position().add(0, 1.0, 0), 1);
        if (enabled) {
            spawnStylizedShockwave(level, player.position().add(0, 1.0, 0), 2.0,
                    new Vector3f(0.10f, 0.82f, 1.0f));
            playEnergyLayer(level, player.position().add(0, 1.0, 0), 0.62f, 1.35f);
        }

        for (int r = 0; r < 3; r++) {
            spawnNeonRing(level, player.position().add(0, 1.0, 0), 1.15 + r * 0.32,
                    new Vector3f(0.15f, 0.8f, 1.0f));
        }

        player.displayClientMessage(
                Component.literal(enabled ? "INFINITY: ON" : "INFINITY: OFF")
                        .withStyle(enabled ? ChatFormatting.AQUA : ChatFormatting.GRAY, ChatFormatting.BOLD),
                true
        );
    }

    private static void castRCT(ServerPlayer player) {
        ServerLevel level = player.serverLevel();
        handSign(player);
        playSfx(level, player, SFX_RCT, 1.05f, 1.1f);
        player.heal(10.0F);
        player.addEffect(new MobEffectInstance(MobEffects.REGENERATION, 100, 1, false, false, true));
        spawnVfx(level, VFX_RCT, player.position().add(0, 1.0, 0), 1);
        spawnStylizedShockwave(level, player.position().add(0, 0.4, 0), 1.8,
                new Vector3f(0.25f, 1.0f, 0.70f));
        spawnEnergySpiral(level, player.position().add(0, 0.15, 0), new Vec3(0, 1, 0),
                2.8, 0.95, 3.0,
                new Vector3f(0.25f, 1.0f, 0.70f),
                new Vector3f(1.0f, 0.30f, 0.68f));
        level.playSound(null, player.blockPosition(), SoundEvents.EXPERIENCE_ORB_PICKUP,
                SoundSource.PLAYERS, 0.70f, 1.55f);

        for (int i = 0; i < 70; i++) {
            sendDust(level,
                    player.position().add(rnd(-0.8, 0.8), rnd(0.05, 1.9), rnd(-0.8, 0.8)),
                    i % 2 == 0 ? new Vector3f(0.35f, 1.0f, 0.8f) : new Vector3f(1.0f, 0.35f, 0.65f),
                    1.0f);
        }

        player.displayClientMessage(
                Component.literal("REVERSED CURSED TECHNIQUE").withStyle(ChatFormatting.GREEN, ChatFormatting.BOLD),
                true
        );
    }

    private static void castTeleport(ServerPlayer player) {
        ServerLevel level = player.serverLevel();
        playSfx(level, player, SFX_TELEPORT, 1.0f, 1.0f);
        Vec3 start = player.position();
        spawnVfx(level, VFX_TELEPORT, start.add(0, 1.0, 0), 1);
        spawnStylizedShockwave(level, start.add(0, 0.8, 0), 1.7,
                new Vector3f(0.18f, 0.78f, 1.0f));
        spawnRadialStar(level, start.add(0, 1.0, 0),
                new Vector3f(0.12f, 0.88f, 1.0f),
                new Vector3f(0.65f, 0.02f, 1.0f),
                10, 2.2);
        Vec3 dir = player.getLookAngle().normalize();
        Vec3 chosen = start;

        for (double d = 12.0; d >= 2.0; d -= 0.5) {
            Vec3 candidate = start.add(dir.scale(d));
            Vec3 delta = candidate.subtract(start);
            AABB moved = player.getBoundingBox().move(delta);
            if (level.noCollision(player, moved)) {
                chosen = candidate;
                break;
            }
        }

        spawnNeonSphere(level, start.add(0, 1.0, 0), 0.9,
                new Vector3f(0.1f, 0.8f, 1.0f), new Vector3f(0.65f, 0.0f, 1.0f));
        player.teleportTo(chosen.x, chosen.y, chosen.z);
        spawnVfx(level, VFX_TELEPORT, chosen.add(0, 1.0, 0), 1);
        spawnStylizedShockwave(level, chosen.add(0, 0.8, 0), 1.9,
                new Vector3f(0.18f, 0.78f, 1.0f));
        spawnVfx(level, VFX_TRAIL, chosen.add(0, 1.0, 0), 2);
        level.playSound(null, chosen.x, chosen.y, chosen.z, SoundEvents.ENDERMAN_TELEPORT,
                SoundSource.PLAYERS, 0.75f, 1.20f);
        player.fallDistance = 0;
        spawnNeonSphere(level, chosen.add(0, 1.0, 0), 0.9,
                new Vector3f(0.1f, 0.8f, 1.0f), new Vector3f(0.65f, 0.0f, 1.0f));

        player.displayClientMessage(
                Component.literal("LIMITLESS BLINK").withStyle(ChatFormatting.AQUA, ChatFormatting.BOLD),
                true
        );
    }

    private static void castDomain(ServerPlayer player) {
        ServerLevel level = player.serverLevel();
        handSign(player);
        playSfx(level, player, SFX_DOMAIN, 1.4f, 0.85f);
        long now = level.getGameTime();

        player.getPersistentData().putLong("jn_domain_until", now + 120);
        player.getPersistentData().putLong("jn_domain_last_pulse", 0);

        Vec3 center = player.position().add(0, 0.2, 0);
        spawnVfx(level, VFX_DOMAIN, center.add(0, 1.4, 0), 2);
        spawnStylizedShockwave(level, center, 6.5, new Vector3f(0.35f, 0.03f, 1.0f));
        spawnRadialStar(level, center.add(0, 1.2, 0),
                new Vector3f(0.10f, 0.85f, 1.0f),
                new Vector3f(0.58f, 0.02f, 1.0f),
                24, 7.0);
        spawnDome(level, center, 7.0,
                new Vector3f(0.08f, 0.75f, 1.0f),
                new Vector3f(0.48f, 0.02f, 1.0f));
        playEnergyLayer(level, center, 1.1f, 0.72f);
        playImpactLayer(level, center, 0.85f, 0.62f);

        for (int r = 1; r <= 4; r++) {
            spawnNeonRing(
                    level,
                    center,
                    r * 1.2,
                    r % 2 == 0
                            ? new Vector3f(0.25f, 0.05f, 1.0f)
                            : new Vector3f(0.0f, 0.85f, 1.0f)
            );
        }

        level.sendParticles(
                ParticleTypes.END_ROD,
                center.x, center.y + 1.0, center.z,
                100,
                4.5, 1.2, 4.5,
                0.02
        );

        player.displayClientMessage(
                Component.literal("DOMAIN EXPANSION")
                        .withStyle(ChatFormatting.LIGHT_PURPLE, ChatFormatting.BOLD),
                true
        );
    }


    private static void handleMovement(ServerPlayer player, MovementAction action) {
        if (player == null || !player.isAlive() || player.isSpectator()) return;

        if (action == MovementAction.SPEED_OFF) {
            player.getPersistentData().putBoolean("jn_super_speed", false);
            return;
        }

        if (!hasGojoBlindfold(player)) {
            player.getPersistentData().putBoolean("jn_super_speed", false);
            if (action != MovementAction.SPEED_ON) {
                requireBlindfoldMessage(player);
            }
            return;
        }

        switch (action) {
            case FRONT_DASH -> dash(player, 0);
            case LEFT_DASH -> dash(player, -1);
            case RIGHT_DASH -> dash(player, 1);
            case EXTRA_JUMP -> extraJump(player);
            case SPEED_ON -> player.getPersistentData().putBoolean("jn_super_speed", true);
            case SPEED_OFF -> player.getPersistentData().putBoolean("jn_super_speed", false);
        }
    }

    /**
     * side = 0  -> вперёд
     * side = -1 -> влево
     * side = 1  -> вправо
     */
    private static void dash(ServerPlayer player, int side) {
        ServerLevel level = player.serverLevel();
        long now = level.getGameTime();
        long cooldown = player.getPersistentData().getLong("jn_dash_cd");

        if (now < cooldown) return;
        player.getPersistentData().putLong("jn_dash_cd", now + 10); // 0.5 сек
        if (!consumeEnergy(player, side == 0 ? 3.0 : 4.0)) return;
        playSfx(level, player, SFX_DASH, 1.0f, side == 0 ? 1.0f : 1.15f);
        spawnVfx(level, VFX_DASH, player.position().add(0, 0.85, 0), 1);
        spawnVfx(level, VFX_TRAIL, player.position().add(0, 0.85, 0), 2);

        Vec3 look = player.getLookAngle();
        Vec3 forward = new Vec3(look.x, 0, look.z);

        if (forward.lengthSqr() < 0.001) {
            forward = new Vec3(0, 0, 1);
        }

        forward = forward.normalize();
        Vec3 direction;

        if (side == 0) {
            direction = forward;
        } else {
            Vec3 right = new Vec3(-forward.z, 0, forward.x);
            direction = side < 0 ? right.scale(-1) : right;
        }

        Vec3 old = player.getDeltaMovement();
        double power = side == 0 ? 2.15 : 1.85;

        player.setDeltaMovement(
                direction.x * power,
                Math.max(old.y, 0.08),
                direction.z * power
        );
        player.hurtMarked = true;

        Vector3f color = side == 0
                ? new Vector3f(0.05f, 0.85f, 1.0f)
                : new Vector3f(0.75f, 0.05f, 1.0f);

        Vec3 base = player.position().add(0, 0.85, 0);

        for (int i = 0; i < 24; i++) {
            Vec3 p = base.subtract(direction.scale(i * 0.16));
            sendDust(
                    level,
                    p.add(rnd(-0.25, 0.25), rnd(-0.35, 0.35), rnd(-0.25, 0.25)),
                    color,
                    1.0f
            );
        }

        level.sendParticles(
                ParticleTypes.ELECTRIC_SPARK,
                player.getX(),
                player.getY() + 0.8,
                player.getZ(),
                22,
                0.35, 0.35, 0.35,
                0.18
        );
    }

    private static void extraJump(ServerPlayer player) {
        if (!player.getPersistentData().getBoolean("jn_super_speed")) {
            return;
        }

        if (player.onGround()) {
            player.getPersistentData().putInt("jn_air_jumps", 0);
            return;
        }

        int jumps = player.getPersistentData().getInt("jn_air_jumps");

        if (jumps >= 10) {
            player.displayClientMessage(
                    Component.literal("Лимит воздушных прыжков: 10")
                            .withStyle(ChatFormatting.GRAY),
                    true
            );
            return;
        }

        if (!consumeEnergy(player, 2.0)) return;

        Vec3 velocity = player.getDeltaMovement();

        player.setDeltaMovement(
                velocity.x * 1.03,
                0.58,
                velocity.z * 1.03
        );
        player.hurtMarked = true;
        player.fallDistance = 0;
        player.getPersistentData().putInt("jn_air_jumps", jumps + 1);

        ServerLevel level = player.serverLevel();
        spawnNeonRing(
                level,
                player.position().add(0, 0.15, 0),
                0.85,
                new Vector3f(0.2f, 0.85f, 1.0f)
        );

        level.sendParticles(
                ParticleTypes.CLOUD,
                player.getX(),
                player.getY() + 0.15,
                player.getZ(),
                12,
                0.28, 0.04, 0.28,
                0.03
        );
    }

    private static boolean isInFront(ServerPlayer player, LivingEntity target, double minDot) {
        Vec3 look = player.getLookAngle().normalize();
        Vec3 toTarget = target.position()
                .add(0, target.getBbHeight() * 0.5, 0)
                .subtract(player.getEyePosition());

        if (toTarget.lengthSqr() < 0.01) return true;
        return look.dot(toTarget.normalize()) >= minDot;
    }

    @Mod.EventBusSubscriber(
            modid = MODID,
            bus = Mod.EventBusSubscriber.Bus.FORGE
    )
    public static class ForgeEvents {

        @SubscribeEvent
        public static void onLivingAttack(LivingAttackEvent event) {
            if (!(event.getEntity() instanceof ServerPlayer player)) return;
            if (!hasGojoBlindfold(player)) return;
            if (!player.getPersistentData().getBoolean("jn_infinity")) return;

            // Infinity блокирует внешние прямые атаки, но не отменяет падение/голод/огонь.
            if (event.getSource().getEntity() != null || event.getSource().getDirectEntity() != null) {
                if (!consumeEnergy(player, 1.5)) {
                    player.getPersistentData().putBoolean("jn_infinity", false);
                    return;
                }
                event.setCanceled(true);
                ServerLevel level = player.serverLevel();
                for (int r = 0; r < 3; r++) {
                    spawnNeonRing(level, player.position().add(0, 1.0, 0), 1.05 + r * 0.24,
                            new Vector3f(0.08f, 0.82f, 1.0f));
                }
            }
        }

        @SubscribeEvent
        public static void onPlayerTick(TickEvent.PlayerTickEvent event) {
            if (event.phase != TickEvent.Phase.END) return;
            if (!(event.player instanceof ServerPlayer player)) return;

            ServerLevel level = player.serverLevel();
            long now = level.getGameTime();
            boolean equipped = hasGojoBlindfold(player);

            if (!equipped) {
                player.getPersistentData().putBoolean("jn_super_speed", false);
                player.getPersistentData().putBoolean("jn_infinity", false);
                player.getPersistentData().putInt("jn_air_jumps", 0);
            } else {
                if (player.onGround()) {
                    player.getPersistentData().putInt("jn_air_jumps", 0);
                }

                boolean flow = player.getPersistentData().getLong("jn_flow_until") > now;
                boolean speed = player.getPersistentData().getBoolean("jn_super_speed");
                boolean infinity = player.getPersistentData().getBoolean("jn_infinity");
                boolean domain = player.getPersistentData().getLong("jn_domain_until") > now;

                // Проклятая энергия: обычная регенерация, FLOW ускоряет восстановление.
                double regen = flow ? 0.55 : 0.28;
                if (speed || infinity || domain) regen *= 0.45;
                setEnergy(player, getEnergy(player) + regen);

                // CTRL: суперскорость, но теперь она реально расходует ресурс.
                if (speed) {
                    if (getEnergy(player) <= 0.2) {
                        player.getPersistentData().putBoolean("jn_super_speed", false);
                    } else {
                        setEnergy(player, getEnergy(player) - 0.18);
                        player.addEffect(new MobEffectInstance(
                                MobEffects.MOVEMENT_SPEED, 6, flow ? 6 : 5,
                                false, false, true
                        ));

                        if (player.zza > 0.0F) {
                            Vec3 look = player.getLookAngle();
                            Vec3 horizontal = new Vec3(look.x, 0, look.z);
                            if (horizontal.lengthSqr() > 0.001) {
                                horizontal = horizontal.normalize().scale(flow ? 0.075 : 0.055);
                                player.setDeltaMovement(player.getDeltaMovement().add(horizontal));
                                player.hurtMarked = true;
                            }
                        }

                        if (now % 2 == 0) {
                            sendDust(level,
                                    player.position().add(rnd(-0.35, 0.35), rnd(0.05, 1.75), rnd(-0.35, 0.35)),
                                    flow ? new Vector3f(0.72f, 0.05f, 1.0f) : new Vector3f(0.05f, 0.85f, 1.0f),
                                    0.85f);
                        }
                    }
                }

                // FLOW после удачного Black Flash.
                if (flow) {
                    player.addEffect(new MobEffectInstance(MobEffects.DAMAGE_BOOST, 6, 0, false, false, true));
                    if (now % 3 == 0) {
                        sendDust(level,
                                player.position().add(rnd(-0.55, 0.55), rnd(0.1, 1.8), rnd(-0.55, 0.55)),
                                new Vector3f(0.72f, 0.03f, 1.0f), 0.75f);
                    }
                }

                if (infinity && now % 3 == 0) {
                    double a = now * 0.25;
                    Vec3 p = player.position().add(Math.cos(a) * 1.25, 1.0 + Math.sin(a * 0.5) * 0.35, Math.sin(a) * 1.25);
                    sendDust(level, p, new Vector3f(0.08f, 0.82f, 1.0f), 0.9f);
                }

                // DOMAIN.
                long until = player.getPersistentData().getLong("jn_domain_until");
                if (until > now) {
                    if (now % 2 == 0) {
                        double pulseRadius = 4.6 + Math.sin(now * 0.25) * 0.5;
                        spawnNeonRing(level, player.position().add(0, 0.15, 0), pulseRadius,
                                new Vector3f(0.35f, 0.03f, 1.0f));

                        level.sendParticles(ParticleTypes.REVERSE_PORTAL,
                                player.getX(), player.getY() + 1.0, player.getZ(),
                                18, 4.0, 1.5, 4.0, 0.02);
                    }

                    long lastPulse = player.getPersistentData().getLong("jn_domain_last_pulse");
                    if (now - lastPulse >= 10) {
                        player.getPersistentData().putLong("jn_domain_last_pulse", now);
                        List<LivingEntity> targets = level.getEntitiesOfClass(
                                LivingEntity.class,
                                player.getBoundingBox().inflate(6.0),
                                e -> e.isAlive() && e != player
                        );

                        for (LivingEntity target : targets) {
                            target.hurt(level.damageSources().playerAttack(player), 2.0F);
                            target.addEffect(new MobEffectInstance(MobEffects.MOVEMENT_SLOWDOWN, 18, 2, false, false, true));
                            target.addEffect(new MobEffectInstance(MobEffects.WEAKNESS, 18, 1, false, false, true));
                        }
                    }
                }
            }

            // Синхронизация HUD 4 раза в секунду.
            if (now % 5 == 0) {
                long flowLeft = Math.max(0, player.getPersistentData().getLong("jn_flow_until") - now);
                NETWORK.send(
                        PacketDistributor.PLAYER.with(() -> player),
                        new HudSyncPacket(
                                getEnergy(player),
                                player.getPersistentData().getInt("jn_air_jumps"),
                                player.getPersistentData().getBoolean("jn_infinity"),
                                (int) flowLeft,
                                equipped
                        )
                );
            }
        }
    }

    private static void spawnVfx(
            ServerLevel level,
            RegistryObject<SimpleParticleType> type,
            Vec3 pos,
            int count
    ) {
        level.sendParticles(
                type.get(),
                pos.x, pos.y, pos.z,
                count,
                0.08, 0.08, 0.08,
                0.0
        );
    }

    private static void spawnNeonSphere(
            ServerLevel level,
            Vec3 center,
            double radius,
            Vector3f colorA,
            Vector3f colorB
    ) {
        for (int i = 0; i < 180; i++) {
            double theta = rnd(0, Math.PI * 2);
            double phi = Math.acos(rnd(-1, 1));

            double x = center.x + radius * Math.sin(phi) * Math.cos(theta);
            double y = center.y + radius * Math.cos(phi);
            double z = center.z + radius * Math.sin(phi) * Math.sin(theta);

            sendDust(
                    level,
                    new Vec3(x, y, z),
                    i % 2 == 0 ? colorA : colorB,
                    1.20f
            );
        }

        level.sendParticles(
                ParticleTypes.ELECTRIC_SPARK,
                center.x, center.y, center.z,
                55,
                1.3, 1.3, 1.3,
                0.18
        );
    }

    private static void spawnNeonRing(
            ServerLevel level,
            Vec3 center,
            double radius,
            Vector3f color
    ) {
        int points = 72;

        for (int i = 0; i < points; i++) {
            double angle = (Math.PI * 2.0 * i) / points;
            double x = center.x + Math.cos(angle) * radius;
            double z = center.z + Math.sin(angle) * radius;

            sendDust(
                    level,
                    new Vec3(x, center.y, z),
                    color,
                    1.25f
            );
        }
    }

    private static void sendDust(
            ServerLevel level,
            Vec3 pos,
            Vector3f color,
            float scale
    ) {
        level.sendParticles(
                new DustParticleOptions(color, scale),
                pos.x, pos.y, pos.z,
                1,
                0, 0, 0,
                0
        );
    }

    private static double rnd(double min, double max) {
        return ThreadLocalRandom.current().nextDouble(min, max);
    }

    private record AbilityPacket(Ability ability) {

        static void encode(AbilityPacket msg, FriendlyByteBuf buf) {
            buf.writeEnum(msg.ability);
        }

        static AbilityPacket decode(FriendlyByteBuf buf) {
            return new AbilityPacket(buf.readEnum(Ability.class));
        }

        static void handle(
                AbilityPacket msg,
                Supplier<NetworkEvent.Context> contextSupplier
        ) {
            NetworkEvent.Context context = contextSupplier.get();

            context.enqueueWork(() -> {
                ServerPlayer player = context.getSender();
                if (player != null) useAbility(player, msg.ability);
            });

            context.setPacketHandled(true);
        }
    }


    private record MovementPacket(MovementAction action) {

        static void encode(MovementPacket msg, FriendlyByteBuf buf) {
            buf.writeEnum(msg.action);
        }

        static MovementPacket decode(FriendlyByteBuf buf) {
            return new MovementPacket(buf.readEnum(MovementAction.class));
        }

        static void handle(
                MovementPacket msg,
                Supplier<NetworkEvent.Context> contextSupplier
        ) {
            NetworkEvent.Context context = contextSupplier.get();

            context.enqueueWork(() -> {
                ServerPlayer player = context.getSender();
                if (player != null) {
                    handleMovement(player, msg.action);
                }
            });

            context.setPacketHandled(true);
        }
    }

    private record HudSyncPacket(double energy, int airJumps, boolean infinity, int flowTicks, boolean blindfold) {

        static void encode(HudSyncPacket msg, FriendlyByteBuf buf) {
            buf.writeDouble(msg.energy);
            buf.writeVarInt(msg.airJumps);
            buf.writeBoolean(msg.infinity);
            buf.writeVarInt(msg.flowTicks);
            buf.writeBoolean(msg.blindfold);
        }

        static HudSyncPacket decode(FriendlyByteBuf buf) {
            return new HudSyncPacket(
                    buf.readDouble(),
                    buf.readVarInt(),
                    buf.readBoolean(),
                    buf.readVarInt(),
                    buf.readBoolean()
            );
        }

        static void handle(HudSyncPacket msg, Supplier<NetworkEvent.Context> contextSupplier) {
            NetworkEvent.Context context = contextSupplier.get();
            context.enqueueWork(() -> DistExecutor.unsafeRunWhenOn(
                    Dist.CLIENT,
                    () -> () -> ClientForgeEvents.applyHudSync(msg)
            ));
            context.setPacketHandled(true);
        }
    }


    @Mod.EventBusSubscriber(
            modid = MODID,
            bus = Mod.EventBusSubscriber.Bus.MOD,
            value = Dist.CLIENT
    )
    public static class ClientModEvents {

        // Эти бинды автоматически появляются в:
        // Настройки -> Управление -> Назначение клавиш.
        // Их можно менять на любые клавиши или кнопки мыши через обычное меню Minecraft.
        private static final String CATEGORY = "Jujutsu Neon — способности";

        public static final KeyMapping DASH_KEY = new KeyMapping(
                "Дэш вперёд / вбок",
                InputConstants.Type.KEYSYM,
                GLFW.GLFW_KEY_Q,
                CATEGORY
        );

        public static final KeyMapping SUPER_SPEED_KEY = new KeyMapping(
                "Суперскорость + мультипрыжок",
                InputConstants.Type.KEYSYM,
                GLFW.GLFW_KEY_LEFT_CONTROL,
                CATEGORY
        );

        public static final KeyMapping BLUE_KEY = new KeyMapping(
                "Z: Blue / удержание: Maximum Blue",
                InputConstants.Type.KEYSYM,
                GLFW.GLFW_KEY_Z,
                CATEGORY
        );

        public static final KeyMapping RED_KEY = new KeyMapping(
                "X: Red / удержание: Hollow Purple",
                InputConstants.Type.KEYSYM,
                GLFW.GLFW_KEY_X,
                CATEGORY
        );

        public static final KeyMapping BLACK_FLASH_KEY = new KeyMapping(
                "C: Black Flash / удержание: Cursed Barrage",
                InputConstants.Type.KEYSYM,
                GLFW.GLFW_KEY_C,
                CATEGORY
        );

        public static final KeyMapping DOMAIN_KEY = new KeyMapping(
                "V: Infinity / удержание: Domain Expansion",
                InputConstants.Type.KEYSYM,
                GLFW.GLFW_KEY_V,
                CATEGORY
        );

        public static final KeyMapping UTILITY_KEY = new KeyMapping(
                "RCT / Limitless Blink (удержание)",
                InputConstants.Type.KEYSYM,
                GLFW.GLFW_KEY_B,
                CATEGORY
        );

        public static final KeyMapping HUD_KEY = new KeyMapping(
                "Показать/скрыть панель способностей",
                InputConstants.Type.KEYSYM,
                GLFW.GLFW_KEY_H,
                CATEGORY
        );

        @SubscribeEvent
        public static void registerParticles(RegisterParticleProvidersEvent event) {
            event.registerSpriteSet(VFX_BLUE.get(), sprites -> new UltraVfxProvider(sprites, 3.8f, 18, 0.015f));
            event.registerSpriteSet(VFX_MAX_BLUE.get(), sprites -> new UltraVfxProvider(sprites, 6.5f, 30, 0.020f));
            event.registerSpriteSet(VFX_RED.get(), sprites -> new UltraVfxProvider(sprites, 5.2f, 18, 0.035f));
            event.registerSpriteSet(VFX_PURPLE.get(), sprites -> new UltraVfxProvider(sprites, 7.5f, 32, 0.018f));
            event.registerSpriteSet(VFX_BLACK_FLASH.get(), sprites -> new UltraVfxProvider(sprites, 4.0f, 14, 0.060f));
            event.registerSpriteSet(VFX_BARRAGE.get(), sprites -> new UltraVfxProvider(sprites, 4.4f, 18, 0.045f));
            event.registerSpriteSet(VFX_INFINITY.get(), sprites -> new UltraVfxProvider(sprites, 4.0f, 28, 0.008f));
            event.registerSpriteSet(VFX_DOMAIN.get(), sprites -> new UltraVfxProvider(sprites, 10.0f, 48, 0.010f));
            event.registerSpriteSet(VFX_RCT.get(), sprites -> new UltraVfxProvider(sprites, 4.5f, 28, 0.018f));
            event.registerSpriteSet(VFX_TELEPORT.get(), sprites -> new UltraVfxProvider(sprites, 4.0f, 14, 0.075f));
            event.registerSpriteSet(VFX_DASH.get(), sprites -> new UltraVfxProvider(sprites, 3.0f, 10, 0.100f));
            event.registerSpriteSet(VFX_SHOCKWAVE.get(), sprites -> new UltraVfxProvider(sprites, 5.8f, 14, 0.090f));
            event.registerSpriteSet(VFX_STAR.get(), sprites -> new UltraVfxProvider(sprites, 4.8f, 10, 0.055f));
            event.registerSpriteSet(VFX_SLASH.get(), sprites -> new UltraVfxProvider(sprites, 4.2f, 12, 0.030f));
            event.registerSpriteSet(VFX_TRAIL.get(), sprites -> new UltraVfxProvider(sprites, 2.2f, 9, 0.030f));
        }

        @SubscribeEvent
        public static void registerKeys(RegisterKeyMappingsEvent event) {
            event.register(DASH_KEY);
            event.register(SUPER_SPEED_KEY);
            event.register(BLUE_KEY);
            event.register(RED_KEY);
            event.register(BLACK_FLASH_KEY);
            event.register(DOMAIN_KEY);
            event.register(UTILITY_KEY);
            event.register(HUD_KEY);
        }
    }

    @Mod.EventBusSubscriber(
            modid = MODID,
            bus = Mod.EventBusSubscriber.Bus.FORGE,
            value = Dist.CLIENT
    )
    public static class ClientForgeEvents {

        private static final int HOLD_TICKS = 20; // 1 секунда
        private static boolean lastSpeedHeld = false;
        private static boolean lastJumpHeld = false;

        private static final HoldKeyState BLUE_STATE = new HoldKeyState();
        private static final HoldKeyState RED_STATE = new HoldKeyState();
        private static final HoldKeyState BLACK_STATE = new HoldKeyState();
        private static final HoldKeyState DOMAIN_STATE = new HoldKeyState();
        private static final HoldKeyState UTILITY_STATE = new HoldKeyState();

        private static String activeAnim = "NONE";
        private static int activeAnimTicks = 0;
        private static int activeAnimLength = 1;
        private static String chargingAnim = "NONE";
        private static float chargingProgress = 0.0f;

        private static boolean hudVisible = true;
        private static double hudEnergy = CE_MAX;
        private static int hudAirJumps = 0;
        private static boolean hudInfinity = false;
        private static int hudFlowTicks = 0;
        private static boolean hudBlindfold = false;

        private static void applyHudSync(HudSyncPacket msg) {
            hudEnergy = msg.energy();
            hudAirJumps = msg.airJumps();
            hudInfinity = msg.infinity();
            hudFlowTicks = msg.flowTicks();
            hudBlindfold = msg.blindfold();
        }

        private static String keyName(KeyMapping mapping) {
            return mapping.getTranslatedKeyMessage().getString().toUpperCase();
        }

        private static class HoldKeyState {
            boolean wasDown;
            int ticks;
            boolean holdTriggered;
        }

        private static void startAnim(String type, int ticks) {
            activeAnim = type;
            activeAnimTicks = ticks;
            activeAnimLength = Math.max(1, ticks);
        }

        private static void processHoldKey(
                KeyMapping key,
                Ability tapAbility,
                Ability holdAbility,
                HoldKeyState state,
                String chargeType
        ) {
            boolean down = key.isDown();

            if (down) {
                if (!state.wasDown) {
                    state.ticks = 0;
                    state.holdTriggered = false;
                }

                state.ticks++;

                if (!state.holdTriggered) {
                    chargingAnim = chargeType;
                    chargingProgress = Mth.clamp(state.ticks / (float) HOLD_TICKS, 0.0f, 1.0f);
                }

                if (!state.holdTriggered && state.ticks >= HOLD_TICKS) {
                    state.holdTriggered = true;
                    chargingAnim = "NONE";
                    chargingProgress = 0.0f;
                    NETWORK.sendToServer(new AbilityPacket(holdAbility));
                    startAnim(holdAbility.name(), 18);
                }
            } else if (state.wasDown) {
                chargingAnim = "NONE";
                chargingProgress = 0.0f;

                if (!state.holdTriggered) {
                    NETWORK.sendToServer(new AbilityPacket(tapAbility));
                    startAnim(tapAbility.name(), 12);
                }

                state.ticks = 0;
                state.holdTriggered = false;
            }

            state.wasDown = down;
        }

        @SubscribeEvent
        public static void onClientTick(TickEvent.ClientTickEvent event) {
            if (event.phase != TickEvent.Phase.END) return;

            Minecraft mc = Minecraft.getInstance();
            if (mc.player == null) return;

            if (activeAnimTicks > 0) activeAnimTicks--;

            if (mc.screen != null) {
                if (lastSpeedHeld) {
                    NETWORK.sendToServer(new MovementPacket(MovementAction.SPEED_OFF));
                    lastSpeedHeld = false;
                }
                lastJumpHeld = false;
                chargingAnim = "NONE";
                return;
            }

            while (ClientModEvents.HUD_KEY.consumeClick()) {
                hudVisible = !hudVisible;
            }

            while (ClientModEvents.DASH_KEY.consumeClick()) {
                if (mc.options.keyLeft.isDown() && !mc.options.keyRight.isDown()) {
                    NETWORK.sendToServer(new MovementPacket(MovementAction.LEFT_DASH));
                } else if (mc.options.keyRight.isDown() && !mc.options.keyLeft.isDown()) {
                    NETWORK.sendToServer(new MovementPacket(MovementAction.RIGHT_DASH));
                } else {
                    NETWORK.sendToServer(new MovementPacket(MovementAction.FRONT_DASH));
                }
                startAnim("DASH", 8);
            }

            boolean speedHeld = ClientModEvents.SUPER_SPEED_KEY.isDown();
            if (speedHeld != lastSpeedHeld) {
                NETWORK.sendToServer(new MovementPacket(speedHeld ? MovementAction.SPEED_ON : MovementAction.SPEED_OFF));
                lastSpeedHeld = speedHeld;
            }

            boolean jumpHeld = mc.options.keyJump.isDown();
            if (speedHeld && jumpHeld && !lastJumpHeld && !mc.player.onGround()) {
                NETWORK.sendToServer(new MovementPacket(MovementAction.EXTRA_JUMP));
            }
            lastJumpHeld = jumpHeld;

            // Короткое нажатие и удержание 1 сек — разные способности.
            // Все базовые кнопки переназначаются через меню управления Minecraft.
            processHoldKey(ClientModEvents.BLUE_KEY, Ability.BLUE, Ability.MAX_BLUE, BLUE_STATE, "CHARGE_BLUE");
            processHoldKey(ClientModEvents.RED_KEY, Ability.RED, Ability.HOLLOW_PURPLE, RED_STATE, "CHARGE_PURPLE");
            processHoldKey(ClientModEvents.BLACK_FLASH_KEY, Ability.BLACK_FLASH, Ability.CURSED_BARRAGE, BLACK_STATE, "CHARGE_BARRAGE");
            processHoldKey(ClientModEvents.DOMAIN_KEY, Ability.INFINITY_TOGGLE, Ability.DOMAIN, DOMAIN_STATE, "CHARGE_DOMAIN");
            processHoldKey(ClientModEvents.UTILITY_KEY, Ability.RCT, Ability.TELEPORT, UTILITY_STATE, "CHARGE_TELEPORT");
        }

        @SubscribeEvent
        public static void onRenderGui(RenderGuiEvent.Post event) {
            if (!hudVisible) return;

            Minecraft mc = Minecraft.getInstance();
            if (mc.player == null || mc.options.hideGui) return;

            GuiGraphics g = event.getGuiGraphics();
            int sw = event.getWindow().getGuiScaledWidth();
            int x = sw - 192;
            int y = 20;
            int w = 178;
            int h = 176;

            // Полупрозрачная карточка справа.
            g.fill(x, y, x + w, y + h, 0xB20A0D14);
            g.fill(x, y, x + 3, y + h, 0xFF20D7FF);
            g.fill(x + 3, y, x + w, y + 2, 0xFF8B3DFF);
            g.fill(x + 3, y + h - 2, x + w, y + h, 0xFF20D7FF);

            g.drawString(mc.font, "LIMITLESS // CONTROL", x + 10, y + 8, 0xFFE7F7FF, false);
            g.drawString(mc.font, hudBlindfold ? "GOJO BLINDFOLD: ONLINE" : "GOJO BLINDFOLD: OFFLINE",
                    x + 10, y + 20, hudBlindfold ? 0xFF69E9FF : 0xFFFF6E78, false);

            int barX = x + 10;
            int barY = y + 34;
            int barW = w - 20;
            g.fill(barX, barY, barX + barW, barY + 7, 0xFF171B28);
            int energyW = (int) Math.round(barW * Mth.clamp(hudEnergy / CE_MAX, 0.0, 1.0));
            g.fill(barX, barY, barX + energyW, barY + 7, 0xFF25D9FF);
            g.fill(barX, barY + 5, barX + energyW, barY + 7, 0xFF8B3DFF);
            g.drawString(mc.font, "CE " + (int) Math.round(hudEnergy) + "%", barX, barY + 10, 0xFFBDEFFF, false);

            int sy = barY + 24;
            drawSkillRow(g, mc, x + 8, sy, keyName(ClientModEvents.DASH_KEY), "Dash", null);
            sy += 18;
            drawSkillRow(g, mc, x + 8, sy, keyName(ClientModEvents.SUPER_SPEED_KEY), "Six Eyes Run", "Jumps " + (10 - Math.min(10, hudAirJumps)) + "/10");
            sy += 18;
            drawSkillRow(g, mc, x + 8, sy, keyName(ClientModEvents.BLUE_KEY), "Blue", "HOLD: Maximum Blue");
            sy += 18;
            drawSkillRow(g, mc, x + 8, sy, keyName(ClientModEvents.RED_KEY), "Red", "HOLD: Hollow Purple");
            sy += 18;
            drawSkillRow(g, mc, x + 8, sy, keyName(ClientModEvents.BLACK_FLASH_KEY), "Black Flash", "HOLD: Barrage");
            sy += 18;
            drawSkillRow(g, mc, x + 8, sy, keyName(ClientModEvents.DOMAIN_KEY), "Infinity", "HOLD: Domain");
            sy += 18;
            drawSkillRow(g, mc, x + 8, sy, keyName(ClientModEvents.UTILITY_KEY), "RCT", "HOLD: Blink");

            if (hudInfinity) {
                g.drawString(mc.font, "INFINITY // ACTIVE", x + 10, y + h - 18, 0xFF6CEBFF, false);
            }
            if (hudFlowTicks > 0) {
                String flow = "FLOW // " + String.format(java.util.Locale.ROOT, "%.1fs", hudFlowTicks / 20.0);
                g.drawString(mc.font, flow, x + 93, y + h - 18, 0xFFD78BFF, false);
            }

            if (!"NONE".equals(chargingAnim)) {
                int cy = y + h + 6;
                g.fill(x, cy, x + w, cy + 16, 0xB20A0D14);
                int cw = (int) ((w - 8) * Mth.clamp(chargingProgress, 0.0f, 1.0f));
                g.fill(x + 4, cy + 4, x + 4 + cw, cy + 12, 0xFF9A49FF);
                g.drawCenteredString(mc.font, "HOLD +  " + (int)(chargingProgress * 100) + "%", x + w / 2, cy + 4, 0xFFFFFFFF);
            }
        }

        private static void drawSkillRow(GuiGraphics g, Minecraft mc, int x, int y, String key, String skill, String hold) {
            int keyW = Math.max(24, mc.font.width(key) + 8);
            g.fill(x, y, x + keyW, y + 14, 0xFF152533);
            g.fill(x, y, x + 2, y + 14, 0xFF28D9FF);
            g.drawCenteredString(mc.font, key, x + keyW / 2, y + 3, 0xFFFFFFFF);
            g.drawString(mc.font, skill, x + keyW + 6, y + 1, 0xFFEAF8FF, false);
            if (hold != null) {
                g.drawString(mc.font, hold, x + keyW + 6, y + 9, 0xFF9BA9C5, false);
            }
        }

        @SubscribeEvent
        public static void onRenderHand(RenderHandEvent event) {
            PoseStack pose = event.getPoseStack();
            boolean main = event.getHand() == InteractionHand.MAIN_HAND;
            float side = main ? 1.0f : -1.0f;

            if (!"NONE".equals(chargingAnim)) {
                float p = chargingProgress;
                float pulse = 0.75f + 0.25f * (float) Math.sin(p * Math.PI * 6.0);

                // Поза зарядки: руки сходятся к центру, напоминает ручные печати,
                // но не копирует конкретную анимацию из аниме.
                pose.translate(-side * 0.22 * p, -0.12 * p, -0.30 * p);
                pose.mulPose(Axis.XP.rotationDegrees(-42.0f * p));
                pose.mulPose(Axis.YP.rotationDegrees(side * (48.0f * p + 8.0f * pulse)));
                pose.mulPose(Axis.ZP.rotationDegrees(-side * 18.0f * p));
                return;
            }

            if (activeAnimTicks <= 0) return;

            float t = 1.0f - activeAnimTicks / (float) activeAnimLength;
            float wave = (float) Math.sin(t * Math.PI);

            switch (activeAnim) {
                case "BLUE", "MAX_BLUE" -> {
                    pose.translate(-side * 0.16 * wave, -0.10 * wave, -0.18 * wave);
                    pose.mulPose(Axis.YP.rotationDegrees(side * 36.0f * wave));
                    pose.mulPose(Axis.XP.rotationDegrees(-28.0f * wave));
                }
                case "RED", "HOLLOW_PURPLE" -> {
                    pose.translate(side * 0.10 * wave, -0.06 * wave, -0.32 * wave);
                    pose.mulPose(Axis.XP.rotationDegrees(-58.0f * wave));
                    pose.mulPose(Axis.ZP.rotationDegrees(side * 22.0f * wave));
                }
                case "BLACK_FLASH", "CURSED_BARRAGE" -> {
                    pose.translate(0, 0, -0.48 * wave);
                    pose.mulPose(Axis.XP.rotationDegrees(-22.0f * wave));
                    pose.mulPose(Axis.ZP.rotationDegrees(side * 10.0f * wave));
                }
                case "DOMAIN", "INFINITY_TOGGLE", "RCT", "TELEPORT" -> {
                    pose.translate(-side * 0.25 * wave, -0.17 * wave, -0.22 * wave);
                    pose.mulPose(Axis.XP.rotationDegrees(-48.0f * wave));
                    pose.mulPose(Axis.YP.rotationDegrees(side * 55.0f * wave));
                }
                case "DASH" -> pose.mulPose(Axis.XP.rotationDegrees(-18.0f * wave));
            }
        }
    }

    private static class UltraVfxParticle extends TextureSheetParticle {
        private final SpriteSet sprites;
        private final float baseSize;
        private final float growth;

        protected UltraVfxParticle(
                ClientLevel level,
                double x, double y, double z,
                double xd, double yd, double zd,
                SpriteSet sprites,
                float size,
                int lifetime,
                float growth
        ) {
            super(level, x, y, z, xd, yd, zd);
            this.sprites = sprites;
            this.baseSize = size;
            this.growth = growth;
            this.lifetime = lifetime;
            this.quadSize = size;
            this.hasPhysics = false;
            this.friction = 0.92f;
            this.gravity = 0.0f;
            this.alpha = 1.0f;
            this.setSpriteFromAge(sprites);
        }

        @Override
        public void tick() {
            super.tick();
            if (!this.removed) {
                this.setSpriteFromAge(this.sprites);
                float life = this.age / (float) Math.max(1, this.lifetime);
                this.alpha = Mth.clamp((1.0f - life) * 1.25f, 0.0f, 1.0f);
                this.quadSize = this.baseSize * (1.0f + life * this.growth * 20.0f);
            }
        }

        @Override
        public ParticleRenderType getRenderType() {
            return ParticleRenderType.PARTICLE_SHEET_TRANSLUCENT;
        }

        @Override
        public int getLightColor(float partialTick) {
            return 0xF000F0;
        }
    }

    private static class UltraVfxProvider implements ParticleProvider<SimpleParticleType> {
        private final SpriteSet sprites;
        private final float size;
        private final int lifetime;
        private final float growth;

        UltraVfxProvider(SpriteSet sprites, float size, int lifetime, float growth) {
            this.sprites = sprites;
            this.size = size;
            this.lifetime = lifetime;
            this.growth = growth;
        }

        @Override
        public Particle createParticle(
                SimpleParticleType type,
                ClientLevel level,
                double x, double y, double z,
                double xd, double yd, double zd
        ) {
            return new UltraVfxParticle(level, x, y, z, xd, yd, zd, sprites, size, lifetime, growth);
        }
    }

    /**
     * Предмет-активатор способностей.
     *
     * Материал возвращает имя "leather", поэтому без отдельной модели
     * Minecraft использует совместимое поведение шлема. Позже можно
     * подложить собственную модель/текстуру повязки через resources.
     */
    private static class GojoBlindfoldItem extends ArmorItem {

        public GojoBlindfoldItem(ArmorMaterial material, Type type, Properties properties) {
            super(material, type, properties);
        }

        @Override
        public Component getName(ItemStack stack) {
            return Component.literal("Повязка Годжо")
                    .withStyle(ChatFormatting.LIGHT_PURPLE);
        }

        @Override
        public String getArmorTexture(ItemStack stack, Entity entity, EquipmentSlot slot, String type) {
            return MODID + ":textures/models/armor/gojo_layer_1.png";
        }
    }

    private enum GojoBlindfoldMaterial implements ArmorMaterial {
        INSTANCE;

        @Override
        public int getDurabilityForType(ArmorItem.Type type) {
            return 275;
        }

        @Override
        public int getDefenseForType(ArmorItem.Type type) {
            return type == ArmorItem.Type.HELMET ? 2 : 0;
        }

        @Override
        public int getEnchantmentValue() {
            return 18;
        }

        @Override
        public SoundEvent getEquipSound() {
            return SoundEvents.ARMOR_EQUIP_LEATHER;
        }

        @Override
        public Ingredient getRepairIngredient() {
            return Ingredient.EMPTY;
        }

        @Override
        public String getName() {
            // Используем ванильную leather-текстуру брони как fallback.
            return "leather";
        }

        @Override
        public float getToughness() {
            return 0.0F;
        }

        @Override
        public float getKnockbackResistance() {
            return 0.0F;
        }
    }
}