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
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.core.particles.BlockParticleOption;
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
import net.minecraft.tags.BlockTags;
import net.minecraft.tags.FluidTags;
import net.minecraft.util.Mth;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.effect.MobEffectInstance;
import net.minecraft.world.effect.MobEffects;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.MoverType;
import net.minecraft.world.entity.item.FallingBlockEntity;
import net.minecraft.world.item.ArmorItem;
import net.minecraft.world.item.ArmorMaterial;
import net.minecraft.world.item.CreativeModeTabs;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Rarity;
import net.minecraft.world.item.crafting.Ingredient;
import net.minecraft.world.level.ClipContext;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.AABB;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.HitResult;
import net.minecraft.world.phys.Vec3;
import net.minecraftforge.api.distmarker.Dist;
import net.minecraftforge.client.event.InputEvent;
import net.minecraftforge.client.event.RegisterKeyMappingsEvent;
import net.minecraftforge.client.event.RegisterParticleProvidersEvent;
import net.minecraftforge.client.event.RenderHandEvent;
import net.minecraftforge.client.event.RenderGuiEvent;
import net.minecraftforge.event.BuildCreativeModeTabContentsEvent;
import net.minecraftforge.event.TickEvent;
import net.minecraftforge.event.entity.living.LivingAttackEvent;
import net.minecraftforge.event.entity.living.LivingEvent;
import net.minecraftforge.event.entity.living.LivingFallEvent;
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

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
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
 * Q — дэш. Q = длинный front dash, A+Q/D+Q = резкий side dash; в воздухе Q идёт по камере.
 * Space — заряд прыжка: <1с = 2 блока, 1с = 7, 2с = 13, 3с = 18.
 * Без Ctrl с повязкой: ходьба ~3x. Left Ctrl — сверхбег ~8x, 1% CE за 2 сек, бег по воде.
 * R — мгновенный телепорт к загруженному блоку под прицелом, стан 2 сек.
 * Z — Blue; удержание 1 сек запускает Maximum Blue, отпускание начинает рассеивание
 * X — Red: отпусти до 2с для обычного выстрела; удержание 2с превращает его в Maximum Red; авто-выстрел на 5с
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
    private static final String PROTOCOL = "13";

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

        NETWORK.registerMessage(
                packetId++,
                BlueActionPacket.class,
                BlueActionPacket::encode,
                BlueActionPacket::decode,
                BlueActionPacket::handle
        );

        NETWORK.registerMessage(
                packetId++,
                RedControlPacket.class,
                RedControlPacket::encode,
                RedControlPacket::decode,
                RedControlPacket::handle
        );

        NETWORK.registerMessage(
                packetId++,
                MaxBlueControlPacket.class,
                MaxBlueControlPacket::encode,
                MaxBlueControlPacket::decode,
                MaxBlueControlPacket::handle
        );

        NETWORK.registerMessage(
                packetId++,
                JumpControlPacket.class,
                JumpControlPacket::encode,
                JumpControlPacket::decode,
                JumpControlPacket::handle
        );

        NETWORK.registerMessage(
                packetId++,
                TeleportPacket.class,
                TeleportPacket::encode,
                TeleportPacket::decode,
                TeleportPacket::handle
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
        SPEED_ON,
        SPEED_OFF
    }

    private enum RedControlAction {
        START,
        RELEASE,
        CANCEL
    }

    private enum MaxBlueControlAction {
        START,
        RELEASE,
        FARTHER,
        CLOSER
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
            case BLUE -> {
                if (castBlue(player)) {
                    setCooldown(player, ability, 100);
                } else {
                    setEnergy(player, getEnergy(player) + cost);
                }
            }
            case MAX_BLUE -> { castMaxBlue(player); setCooldown(player, ability, 220); }
            case RED -> { castRed(player); setCooldown(player, ability, 140); }
            case HOLLOW_PURPLE -> { castHollowPurple(player); setCooldown(player, ability, 420); }
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
     * Common safety rule for destructive Limitless techniques.
     * - A real solid block currently supporting the owner is protected.
     * - Any block/fluid cell actually occupied by the owner's hitbox is protected.
     * - In air there is no fake protected floor.
     * - In water/lava only the fluid cell containing the owner is protected; blocks below remain valid targets.
     */
    private static boolean isOwnerSafeBlock(ServerPlayer owner, BlockPos pos) {
        ServerLevel level = owner.serverLevel();

        AABB body = owner.getBoundingBox().inflate(0.001);
        AABB cell = new AABB(
                pos.getX(), pos.getY(), pos.getZ(),
                pos.getX() + 1.0, pos.getY() + 1.0, pos.getZ() + 1.0
        );

        if (body.intersects(cell)) return true;

        BlockPos support = BlockPos.containing(
                owner.getX(),
                owner.getY() - 0.05,
                owner.getZ()
        );

        if (!pos.equals(support)) return false;

        BlockState supportState = level.getBlockState(support);
        return !supportState.isAir() &&
                supportState.getFluidState().isEmpty() &&
                !supportState.getCollisionShape(level, support).isEmpty();
    }

    private static Map<BlockPos, BlockState> snapshotOwnerSafeBlocks(ServerPlayer owner) {
        ServerLevel level = owner.serverLevel();
        Map<BlockPos, BlockState> result = new HashMap<>();

        AABB body = owner.getBoundingBox().inflate(0.001);
        int minX = Mth.floor(body.minX);
        int maxX = Mth.floor(body.maxX);
        int minY = Mth.floor(body.minY);
        int maxY = Mth.floor(body.maxY);
        int minZ = Mth.floor(body.minZ);
        int maxZ = Mth.floor(body.maxZ);

        for (int x = minX; x <= maxX; x++) {
            for (int y = minY; y <= maxY; y++) {
                for (int z = minZ; z <= maxZ; z++) {
                    BlockPos pos = new BlockPos(x, y, z);
                    if (isOwnerSafeBlock(owner, pos)) {
                        result.put(pos.immutable(), level.getBlockState(pos));
                    }
                }
            }
        }

        BlockPos support = BlockPos.containing(owner.getX(), owner.getY() - 0.05, owner.getZ());
        if (isOwnerSafeBlock(owner, support)) {
            result.put(support.immutable(), level.getBlockState(support));
        }

        return result;
    }

    private static void restoreOwnerSafeBlocks(ServerPlayer owner, Map<BlockPos, BlockState> safeStates) {
        ServerLevel level = owner.serverLevel();

        for (Map.Entry<BlockPos, BlockState> entry : safeStates.entrySet()) {
            BlockPos pos = entry.getKey();
            BlockState original = entry.getValue();

            if (!level.getBlockState(pos).equals(original)) {
                level.setBlock(pos, original, 2 | 16 | 32);
            }
        }
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

    private static final int BLUE_MODE_NONE = 0;
    private static final int BLUE_MODE_BLOCKS = 1;
    private static final int BLUE_MODE_ENTITY = 2;
    private static final int BLUE_MODE_PROJECTILE = 3;
    private static final double BLUE_RANGE = 7.0;

    private static boolean isBlueInteractionActive(ServerPlayer player) {
        int mode = player.getPersistentData().getInt("jn_blue_mode");
        return mode == BLUE_MODE_BLOCKS || mode == BLUE_MODE_ENTITY;
    }

    private static LivingEntity findBlueLivingTarget(ServerLevel level, ServerPlayer player) {
        Vec3 start = player.getEyePosition();
        Vec3 look = player.getLookAngle().normalize();
        Vec3 end = start.add(look.scale(BLUE_RANGE));

        BlockHitResult blockHit = level.clip(new ClipContext(
                start, end,
                ClipContext.Block.OUTLINE,
                ClipContext.Fluid.NONE,
                player
        ));

        double blockDistanceSq = blockHit.getType() == HitResult.Type.MISS
                ? BLUE_RANGE * BLUE_RANGE
                : start.distanceToSqr(blockHit.getLocation());

        AABB searchBox = player.getBoundingBox()
                .expandTowards(look.scale(BLUE_RANGE))
                .inflate(1.25);

        return level.getEntitiesOfClass(
                        LivingEntity.class,
                        searchBox,
                        e -> e.isAlive() && e != player && !e.isSpectator()
                )
                .stream()
                .filter(e -> e.getBoundingBox().inflate(0.35).clip(start, end)
                        .map(hit -> start.distanceToSqr(hit) <= blockDistanceSq + 0.20)
                        .orElse(false))
                .min(Comparator.comparingDouble(e -> start.distanceToSqr(e.getBoundingBox().getCenter())))
                .orElse(null);
    }

    private static List<BlockPos> findBlueBlocks(ServerLevel level, ServerPlayer owner, BlockPos center) {
        List<BlockPos> candidates = new ArrayList<>();

        for (int dy = -2; dy <= 2; dy++) {
            for (int dx = -2; dx <= 2; dx++) {
                for (int dz = -2; dz <= 2; dz++) {
                    BlockPos pos = center.offset(dx, dy, dz);
                    BlockState state = level.getBlockState(pos);

                    if (state.isAir()) continue;
                    if (isOwnerSafeBlock(owner, pos)) continue;
                    if (state.hasBlockEntity()) continue;
                    if (!state.getFluidState().isEmpty()) continue;
                    if (state.getDestroySpeed(level, pos) < 0.0F) continue;
                    if (state.is(Blocks.MOVING_PISTON) || state.is(Blocks.END_PORTAL) || state.is(Blocks.NETHER_PORTAL)) continue;

                    candidates.add(pos.immutable());
                }
            }
        }

        candidates.sort(Comparator.comparingDouble(p -> p.distSqr(center)));
        if (candidates.size() > 5) {
            return new ArrayList<>(candidates.subList(0, 5));
        }
        return candidates;
    }

    private static Vec3 horizontalLook(ServerPlayer player) {
        Vec3 look = player.getLookAngle();
        Vec3 horizontal = new Vec3(look.x, 0.0, look.z);
        if (horizontal.lengthSqr() < 1.0E-4) {
            double yaw = Math.toRadians(player.getYRot());
            horizontal = new Vec3(-Math.sin(yaw), 0.0, Math.cos(yaw));
        }
        return horizontal.normalize();
    }

    private static void startBlueEntityHold(ServerPlayer player, LivingEntity target) {
        ServerLevel level = player.serverLevel();
        long now = level.getGameTime();

        Vec3 forward = horizontalLook(player);
        Vec3 targetLock = player.position().add(forward.scale(2.35));
        targetLock = new Vec3(targetLock.x, player.getY() + 0.10, targetLock.z);

        target.teleportTo(targetLock.x, targetLock.y, targetLock.z);
        target.setDeltaMovement(Vec3.ZERO);
        target.hurtMarked = true;

        player.getPersistentData().putInt("jn_blue_mode", BLUE_MODE_ENTITY);
        player.getPersistentData().putString("jn_blue_target_uuid", target.getStringUUID());
        player.getPersistentData().putLong("jn_blue_until", now + 40);

        player.getPersistentData().putDouble("jn_blue_owner_x", player.getX());
        player.getPersistentData().putDouble("jn_blue_owner_y", player.getY());
        player.getPersistentData().putDouble("jn_blue_owner_z", player.getZ());

        player.getPersistentData().putDouble("jn_blue_target_x", targetLock.x);
        player.getPersistentData().putDouble("jn_blue_target_y", targetLock.y);
        player.getPersistentData().putDouble("jn_blue_target_z", targetLock.z);

        for (int i = 0; i < 18; i++) {
            double t = i / 17.0;
            Vec3 p = player.getEyePosition().lerp(
                    target.position().add(0.0, target.getBbHeight() * 0.55, 0.0),
                    t
            );
            sendDust(level, p, new Vector3f(0.18f, 0.72f, 1.0f), 0.72f);
        }

        playSfx(level, player, SFX_BLUE, 0.72f, 1.12f);
        player.displayClientMessage(
                Component.literal("BLUE // ЦЕЛЬ ЗАФИКСИРОВАНА // ЛКМ: ОТБРОСИТЬ")
                        .withStyle(ChatFormatting.AQUA),
                true
        );
    }

    private static boolean startBlueBlockHold(ServerPlayer player, BlockHitResult hit) {
        ServerLevel level = player.serverLevel();
        List<BlockPos> blocks = findBlueBlocks(level, player, hit.getBlockPos());

        if (blocks.size() < 5) {
            player.displayClientMessage(
                    Component.literal("BLUE // рядом с курсором нужно 5 подходящих блоков")
                            .withStyle(ChatFormatting.GRAY),
                    true
            );
            return false;
        }

        int[] ids = new int[5];
        for (int i = 0; i < 5; i++) {
            BlockPos pos = blocks.get(i);
            BlockState state = level.getBlockState(pos);
            FallingBlockEntity falling = FallingBlockEntity.fall(level, pos, state);
            falling.setNoGravity(true);
            falling.noPhysics = true;
            falling.setDeltaMovement(Vec3.ZERO);
            falling.fallDistance = 0.0F;
            ids[i] = falling.getId();
        }

        player.getPersistentData().putInt("jn_blue_mode", BLUE_MODE_BLOCKS);
        player.getPersistentData().putIntArray("jn_blue_block_ids", ids);
        player.getPersistentData().putLong("jn_blue_until", level.getGameTime() + 200);

        playSfx(level, player, SFX_BLUE, 0.68f, 1.18f);
        player.displayClientMessage(
                Component.literal("BLUE // 5 БЛОКОВ ЗАХВАЧЕНО // ЛКМ: БРОСИТЬ")
                        .withStyle(ChatFormatting.AQUA),
                true
        );
        return true;
    }

    private static boolean castBlue(ServerPlayer player) {
        if (isBlueInteractionActive(player) ||
                player.getPersistentData().getInt("jn_blue_mode") == BLUE_MODE_PROJECTILE) {
            player.displayClientMessage(
                    Component.literal("BLUE // предыдущий захват ещё активен")
                            .withStyle(ChatFormatting.GRAY),
                    true
            );
            return false;
        }

        ServerLevel level = player.serverLevel();
        handSign(player);

        LivingEntity target = findBlueLivingTarget(level, player);
        if (target != null) {
            startBlueEntityHold(player, target);
            return true;
        }

        Vec3 start = player.getEyePosition();
        Vec3 end = start.add(player.getLookAngle().normalize().scale(BLUE_RANGE));
        BlockHitResult blockHit = level.clip(new ClipContext(
                start, end,
                ClipContext.Block.OUTLINE,
                ClipContext.Fluid.NONE,
                player
        ));

        if (blockHit.getType() == HitResult.Type.MISS) {
            player.displayClientMessage(
                    Component.literal("BLUE // нет цели под курсором")
                            .withStyle(ChatFormatting.GRAY),
                    true
            );
            return false;
        }

        return startBlueBlockHold(player, blockHit);
    }

    private static LivingEntity getBlueTarget(ServerLevel level, ServerPlayer player) {
        String raw = player.getPersistentData().getString("jn_blue_target_uuid");
        if (raw == null || raw.isEmpty()) return null;

        try {
            Entity e = level.getEntity(UUID.fromString(raw));
            return e instanceof LivingEntity living && living.isAlive() ? living : null;
        } catch (IllegalArgumentException ignored) {
            return null;
        }
    }

    private static void clearBlueState(ServerPlayer player) {
        player.getPersistentData().putInt("jn_blue_mode", BLUE_MODE_NONE);
        player.getPersistentData().remove("jn_blue_target_uuid");
        player.getPersistentData().remove("jn_blue_block_ids");
        player.getPersistentData().remove("jn_blue_until");
        player.getPersistentData().remove("jn_blue_projectile_until");
        player.getPersistentData().remove("jn_blue_owner_x");
        player.getPersistentData().remove("jn_blue_owner_y");
        player.getPersistentData().remove("jn_blue_owner_z");
        player.getPersistentData().remove("jn_blue_target_x");
        player.getPersistentData().remove("jn_blue_target_y");
        player.getPersistentData().remove("jn_blue_target_z");
    }

    private static void releaseBlueBlocks(ServerPlayer player, boolean launch) {
        ServerLevel level = player.serverLevel();
        int[] ids = player.getPersistentData().getIntArray("jn_blue_block_ids");

        if (!launch) {
            for (int id : ids) {
                Entity e = level.getEntity(id);
                if (e instanceof FallingBlockEntity falling) {
                    falling.noPhysics = false;
                    falling.setNoGravity(false);
                    falling.setDeltaMovement(new Vec3(rnd(-0.08, 0.08), 0.03, rnd(-0.08, 0.08)));
                    falling.fallDistance = 0.0F;
                }
            }
            clearBlueState(player);
            return;
        }

        Vec3 dir = player.getLookAngle().normalize();
        for (int i = 0; i < ids.length; i++) {
            Entity e = level.getEntity(ids[i]);
            if (e instanceof FallingBlockEntity falling) {
                falling.noPhysics = false;
                falling.setNoGravity(false);
                Vec3 spread = new Vec3(
                        rnd(-0.035, 0.035),
                        rnd(-0.020, 0.040),
                        rnd(-0.035, 0.035)
                );
                falling.setDeltaMovement(dir.scale(2.85).add(spread));
                falling.hurtMarked = true;
                falling.fallDistance = 0.0F;
            }
        }

        player.getPersistentData().putInt("jn_blue_mode", BLUE_MODE_PROJECTILE);
        player.getPersistentData().putLong("jn_blue_projectile_until", level.getGameTime() + 70);
        playSfx(level, player, SFX_BLUE, 0.82f, 1.32f);
    }

    private static void releaseBlueEntity(ServerPlayer player, boolean throwTarget) {
        ServerLevel level = player.serverLevel();
        LivingEntity target = getBlueTarget(level, player);

        if (target != null) {
            target.setDeltaMovement(Vec3.ZERO);

            if (throwTarget) {
                Vec3 dir = player.getLookAngle().normalize();

                player.getPersistentData().putBoolean("jn_blue_custom_damage", true);
                target.hurt(level.damageSources().playerAttack(player), 40.0F); // 20 сердец
                player.getPersistentData().putBoolean("jn_blue_custom_damage", false);

                target.setDeltaMovement(dir.scale(3.25).add(0.0, 0.48, 0.0));
                target.hurtMarked = true;

                Vec3 impact = target.position().add(0.0, target.getBbHeight() * 0.5, 0.0);
                for (int i = 0; i < 28; i++) {
                    sendDust(level,
                            impact.add(rnd(-0.45, 0.45), rnd(-0.45, 0.45), rnd(-0.45, 0.45)),
                            new Vector3f(0.15f, 0.74f, 1.0f),
                            0.90f);
                }

                playImpactLayer(level, impact, 0.72f, 1.35f);
            }
        }

        player.setDeltaMovement(Vec3.ZERO);
        clearBlueState(player);
    }

    private static void bluePrimaryAction(ServerPlayer player) {
        int mode = player.getPersistentData().getInt("jn_blue_mode");

        if (mode == BLUE_MODE_BLOCKS) {
            releaseBlueBlocks(player, true);
        } else if (mode == BLUE_MODE_ENTITY) {
            releaseBlueEntity(player, true);
        }
    }

    private static void tickBlueState(ServerPlayer player, ServerLevel level, long now) {
        int mode = player.getPersistentData().getInt("jn_blue_mode");
        if (mode == BLUE_MODE_NONE) return;

        if (!hasGojoBlindfold(player) || !player.isAlive()) {
            if (mode == BLUE_MODE_BLOCKS) releaseBlueBlocks(player, false);
            else if (mode == BLUE_MODE_ENTITY) releaseBlueEntity(player, false);
            else clearBlueState(player);
            return;
        }

        if (mode == BLUE_MODE_BLOCKS) {
            player.setSprinting(false);

            if (now >= player.getPersistentData().getLong("jn_blue_until")) {
                releaseBlueBlocks(player, false);
                return;
            }

            int[] ids = player.getPersistentData().getIntArray("jn_blue_block_ids");
            Vec3 forward = player.getLookAngle().normalize();
            Vec3 right = forward.cross(new Vec3(0.0, 1.0, 0.0));
            if (right.lengthSqr() < 1.0E-4) right = new Vec3(1.0, 0.0, 0.0);
            right = right.normalize();
            Vec3 up = right.cross(forward).normalize();
            Vec3 center = player.getEyePosition().add(forward.scale(2.75)).add(0.0, -0.30, 0.0);

            double[][] offsets = {
                    {0.00, 0.00},
                    {0.34, 0.05},
                    {-0.34, 0.05},
                    {0.08, 0.34},
                    {-0.08, -0.34}
            };

            for (int i = 0; i < ids.length && i < offsets.length; i++) {
                Entity e = level.getEntity(ids[i]);
                if (!(e instanceof FallingBlockEntity falling)) continue;

                Vec3 pos = center
                        .add(right.scale(offsets[i][0]))
                        .add(up.scale(offsets[i][1]));

                falling.setPos(pos.x, pos.y, pos.z);
                falling.setDeltaMovement(Vec3.ZERO);
                falling.setNoGravity(true);
                falling.noPhysics = true;
                falling.fallDistance = 0.0F;
            }

            if (now % 2 == 0) {
                sendDust(level,
                        center.add(rnd(-0.45, 0.45), rnd(-0.35, 0.35), rnd(-0.45, 0.45)),
                        new Vector3f(0.18f, 0.72f, 1.0f),
                        0.62f);
            }
            return;
        }

        if (mode == BLUE_MODE_ENTITY) {
            LivingEntity target = getBlueTarget(level, player);

            if (target == null || now >= player.getPersistentData().getLong("jn_blue_until")) {
                releaseBlueEntity(player, false);
                return;
            }

            double ox = player.getPersistentData().getDouble("jn_blue_owner_x");
            double oy = player.getPersistentData().getDouble("jn_blue_owner_y");
            double oz = player.getPersistentData().getDouble("jn_blue_owner_z");

            double tx = player.getPersistentData().getDouble("jn_blue_target_x");
            double ty = player.getPersistentData().getDouble("jn_blue_target_y");
            double tz = player.getPersistentData().getDouble("jn_blue_target_z");

            player.teleportTo(ox, oy, oz);
            player.setDeltaMovement(Vec3.ZERO);
            player.setSprinting(false);
            player.fallDistance = 0.0F;

            target.teleportTo(tx, ty, tz);
            target.setDeltaMovement(Vec3.ZERO);
            target.setSprinting(false);
            target.fallDistance = 0.0F;
            target.hurtMarked = true;

            if (now % 2 == 0) {
                Vec3 mid = player.getEyePosition().lerp(
                        target.position().add(0.0, target.getBbHeight() * 0.55, 0.0),
                        0.55
                );
                sendDust(level, mid, new Vector3f(0.16f, 0.70f, 1.0f), 0.66f);
            }
            return;
        }

        if (mode == BLUE_MODE_PROJECTILE) {
            int[] ids = player.getPersistentData().getIntArray("jn_blue_block_ids");
            LivingEntity hit = null;

            for (int id : ids) {
                Entity e = level.getEntity(id);
                if (!(e instanceof FallingBlockEntity falling) || !falling.isAlive()) continue;

                List<LivingEntity> hits = level.getEntitiesOfClass(
                        LivingEntity.class,
                        falling.getBoundingBox().inflate(0.65),
                        living -> living.isAlive() && living != player
                );

                if (!hits.isEmpty()) {
                    hit = hits.get(0);
                    break;
                }
            }

            if (hit != null) {
                player.getPersistentData().putBoolean("jn_blue_custom_damage", true);
                hit.hurt(level.damageSources().playerAttack(player), 20.0F); // 10 сердец
                player.getPersistentData().putBoolean("jn_blue_custom_damage", false);

                Vec3 dir = player.getLookAngle().normalize();
                hit.setDeltaMovement(hit.getDeltaMovement().add(dir.scale(1.25)).add(0.0, 0.28, 0.0));
                hit.hurtMarked = true;

                Vec3 impact = hit.position().add(0.0, hit.getBbHeight() * 0.5, 0.0);
                for (int i = 0; i < 22; i++) {
                    sendDust(level,
                            impact.add(rnd(-0.42, 0.42), rnd(-0.42, 0.42), rnd(-0.42, 0.42)),
                            new Vector3f(0.16f, 0.72f, 1.0f),
                            0.82f);
                }
                playImpactLayer(level, impact, 0.62f, 1.42f);

                for (int id : ids) {
                    Entity e = level.getEntity(id);
                    if (e instanceof FallingBlockEntity falling) {
                        falling.noPhysics = false;
                        falling.setNoGravity(false);
                        falling.setDeltaMovement(falling.getDeltaMovement().scale(0.38)
                                .add(rnd(-0.12, 0.12), 0.10, rnd(-0.12, 0.12)));
                    }
                }

                clearBlueState(player);
                return;
            }

            if (now >= player.getPersistentData().getLong("jn_blue_projectile_until")) {
                clearBlueState(player);
            }
        }
    }


    private static final int MAX_BLUE_PHASE_NONE = 0;
    private static final int MAX_BLUE_PHASE_FORMING = 1;
    private static final int MAX_BLUE_PHASE_ACTIVE = 2;
    private static final int MAX_BLUE_PHASE_FADING = 3;

    private static final long MAX_BLUE_FORM_TICKS = 60L;
    private static final long MAX_BLUE_ACTIVE_TICKS = 160L;
    private static final long MAX_BLUE_FADE_TICKS = 20L;
    private static final double MAX_BLUE_RADIUS = 2.0;
    private static final double MAX_BLUE_ZONE_HALF = 3.0;
    private static final double MAX_BLUE_MIN_DISTANCE = 3.0;
    private static final double MAX_BLUE_MAX_DISTANCE = 20.0;
    private static final float MAX_BLUE_DAMAGE = 14.0F;

    private static final Map<UUID, List<MaxBlueSuctionBlock>> MAX_BLUE_SUCTION = new HashMap<>();

    private static class MaxBlueSuctionBlock {
        final int entityId;
        final Vec3 start;
        final long startTick;
        final double phaseOffset;

        MaxBlueSuctionBlock(int entityId, Vec3 start, long startTick, double phaseOffset) {
            this.entityId = entityId;
            this.start = start;
            this.startTick = startTick;
            this.phaseOffset = phaseOffset;
        }
    }

    private static boolean isMaximumBlueActive(ServerPlayer player) {
        return player.getPersistentData().getInt("jn_max_blue_phase") != MAX_BLUE_PHASE_NONE;
    }

    private static double maxBlueSmooth(double t) {
        t = Mth.clamp(t, 0.0, 1.0);
        return t * t * (3.0 - 2.0 * t);
    }

    private static Vec3 maxBlueFormationCenter(ServerPlayer player, double progress, double desiredDistance) {
        double eased = maxBlueSmooth(progress);

        Vec3 eye = player.getEyePosition();
        Vec3 look = player.getLookAngle().normalize();
        Vec3 finalPos = eye.add(look.scale(desiredDistance));

        double angle = progress * Math.PI * 4.0;
        double orbitRadius = 2.7 * (1.0 - eased) + 0.25;
        Vec3 orbitPos = player.position().add(
                Math.cos(angle) * orbitRadius,
                1.15 + Math.sin(angle * 1.5) * 0.72,
                Math.sin(angle) * orbitRadius
        );

        return orbitPos.lerp(finalPos, eased);
    }

    private static double currentMaximumBlueRadius(ServerPlayer player, long now) {
        int phase = player.getPersistentData().getInt("jn_max_blue_phase");

        if (phase == MAX_BLUE_PHASE_FORMING) {
            long start = player.getPersistentData().getLong("jn_max_blue_phase_start");
            double p = Mth.clamp((now - start) / (double) MAX_BLUE_FORM_TICKS, 0.0, 1.0);
            return 0.12 + (MAX_BLUE_RADIUS - 0.12) * maxBlueSmooth(p);
        }

        if (phase == MAX_BLUE_PHASE_ACTIVE) return MAX_BLUE_RADIUS;

        if (phase == MAX_BLUE_PHASE_FADING) {
            long fadeStart = player.getPersistentData().getLong("jn_max_blue_phase_start");
            double p = Mth.clamp((now - fadeStart) / (double) MAX_BLUE_FADE_TICKS, 0.0, 1.0);
            double startRadius = player.getPersistentData().getDouble("jn_max_blue_fade_radius");
            return Math.max(0.0, startRadius * (1.0 - maxBlueSmooth(p)));
        }

        return 0.0;
    }

    private static Vec3 currentMaximumBlueCenter(ServerPlayer player, long now) {
        int phase = player.getPersistentData().getInt("jn_max_blue_phase");

        if (phase == MAX_BLUE_PHASE_FADING) {
            return new Vec3(
                    player.getPersistentData().getDouble("jn_max_blue_fade_x"),
                    player.getPersistentData().getDouble("jn_max_blue_fade_y"),
                    player.getPersistentData().getDouble("jn_max_blue_fade_z")
            );
        }

        double distance = Mth.clamp(
                player.getPersistentData().getDouble("jn_max_blue_distance"),
                MAX_BLUE_MIN_DISTANCE,
                MAX_BLUE_MAX_DISTANCE
        );

        if (phase == MAX_BLUE_PHASE_FORMING) {
            long start = player.getPersistentData().getLong("jn_max_blue_phase_start");
            double p = Mth.clamp((now - start) / (double) MAX_BLUE_FORM_TICKS, 0.0, 1.0);
            return maxBlueFormationCenter(player, p, distance);
        }

        return player.getEyePosition().add(player.getLookAngle().normalize().scale(distance));
    }

    private static boolean startMaximumBlue(ServerPlayer player) {
        if (player == null || !player.isAlive() || player.isSpectator()) return false;
        if (!hasGojoBlindfold(player)) {
            requireBlindfoldMessage(player);
            return false;
        }
        if (isMaximumBlueActive(player)) return false;

        long now = player.level().getGameTime();
        long cooldownUntil = player.getPersistentData().getLong("jn_cd_max_blue");
        if (now < cooldownUntil) {
            long ticksLeft = cooldownUntil - now;
            double seconds = Math.ceil(ticksLeft / 2.0) / 10.0;
            player.displayClientMessage(
                    Component.literal("Maximum Blue: перезарядка " + seconds + " сек.")
                            .withStyle(ChatFormatting.GRAY),
                    true
            );
            return false;
        }

        double cost = abilityCost(player, Ability.MAX_BLUE);
        if (!consumeEnergy(player, cost)) return false;

        player.getPersistentData().putInt("jn_max_blue_phase", MAX_BLUE_PHASE_FORMING);
        player.getPersistentData().putLong("jn_max_blue_phase_start", now);
        player.getPersistentData().putDouble("jn_max_blue_distance", 6.0);

        player.getPersistentData().putDouble("jn_max_blue_lock_x", player.getX());
        player.getPersistentData().putDouble("jn_max_blue_lock_y", player.getY());
        player.getPersistentData().putDouble("jn_max_blue_lock_z", player.getZ());

        Vec3 center = currentMaximumBlueCenter(player, now);
        player.getPersistentData().putDouble("jn_max_blue_x", center.x);
        player.getPersistentData().putDouble("jn_max_blue_y", center.y);
        player.getPersistentData().putDouble("jn_max_blue_z", center.z);

        setCooldown(player, Ability.MAX_BLUE, 220);
        playSfx(player.serverLevel(), player, SFX_MAX_BLUE, 1.15f, 0.84f);
        handSign(player);

        player.displayClientMessage(
                Component.literal("MAXIMUM BLUE // ФОРМИРОВАНИЕ")
                        .withStyle(ChatFormatting.AQUA, ChatFormatting.BOLD),
                true
        );
        return true;
    }

    private static void adjustMaximumBlueDistance(ServerPlayer player, double delta) {
        if (!isMaximumBlueActive(player)) return;
        if (player.getPersistentData().getInt("jn_max_blue_phase") == MAX_BLUE_PHASE_FADING) return;

        double distance = player.getPersistentData().getDouble("jn_max_blue_distance");
        player.getPersistentData().putDouble(
                "jn_max_blue_distance",
                Mth.clamp(distance + delta, MAX_BLUE_MIN_DISTANCE, MAX_BLUE_MAX_DISTANCE)
        );
    }

    private static void beginMaximumBlueFade(ServerPlayer player) {
        int phase = player.getPersistentData().getInt("jn_max_blue_phase");
        if (phase == MAX_BLUE_PHASE_NONE || phase == MAX_BLUE_PHASE_FADING) return;

        long now = player.level().getGameTime();
        Vec3 center = currentMaximumBlueCenter(player, now);
        double radius = currentMaximumBlueRadius(player, now);

        player.getPersistentData().putInt("jn_max_blue_phase", MAX_BLUE_PHASE_FADING);
        player.getPersistentData().putLong("jn_max_blue_phase_start", now);
        player.getPersistentData().putDouble("jn_max_blue_fade_radius", Math.max(0.08, radius));
        player.getPersistentData().putDouble("jn_max_blue_fade_x", center.x);
        player.getPersistentData().putDouble("jn_max_blue_fade_y", center.y);
        player.getPersistentData().putDouble("jn_max_blue_fade_z", center.z);
    }

    private static void clearMaximumBlue(ServerPlayer player) {
        List<MaxBlueSuctionBlock> visuals = MAX_BLUE_SUCTION.remove(player.getUUID());
        if (visuals != null) {
            for (MaxBlueSuctionBlock entry : visuals) {
                Entity e = player.serverLevel().getEntity(entry.entityId);
                if (e != null) e.discard();
            }
        }

        player.getPersistentData().putInt("jn_max_blue_phase", MAX_BLUE_PHASE_NONE);
        for (String key : new String[]{
                "jn_max_blue_phase_start","jn_max_blue_distance",
                "jn_max_blue_lock_x","jn_max_blue_lock_y","jn_max_blue_lock_z",
                "jn_max_blue_fade_radius","jn_max_blue_fade_x","jn_max_blue_fade_y","jn_max_blue_fade_z",
                "jn_max_blue_x","jn_max_blue_y","jn_max_blue_z"}) {
            player.getPersistentData().remove(key);
        }
    }

    private static void spawnMaximumBlueVisual(ServerLevel level, Vec3 center, double radius, long now, double fadeFactor) {
        if (radius <= 0.02 || fadeFactor <= 0.01) return;

        int shellPoints = Math.max(18, (int) (86 * fadeFactor));
        double golden = Math.PI * (3.0 - Math.sqrt(5.0));

        for (int i = 0; i < shellPoints; i++) {
            double y = 1.0 - (i / (double) Math.max(1, shellPoints - 1)) * 2.0;
            double ring = Math.sqrt(Math.max(0.0, 1.0 - y * y));
            double theta = golden * i + now * 0.055;

            Vec3 p = center.add(
                    Math.cos(theta) * ring * radius,
                    y * radius,
                    Math.sin(theta) * ring * radius
            );

            sendDust(level, p,
                    i % 3 == 0 ? new Vector3f(0.02f, 0.86f, 1.0f) : new Vector3f(0.02f, 0.32f, 1.0f),
                    (float) (0.68 + 0.28 * fadeFactor));
        }

        int ringPoints = Math.max(16, (int) (42 * fadeFactor));
        for (int plane = 0; plane < 3; plane++) {
            for (int i = 0; i < ringPoints; i++) {
                double a = Math.PI * 2.0 * i / ringPoints + now * (0.045 + plane * 0.015);
                double r = radius * (1.10 + plane * 0.06);
                Vec3 p;
                if (plane == 0) p = center.add(Math.cos(a) * r, 0.0, Math.sin(a) * r);
                else if (plane == 1) p = center.add(Math.cos(a) * r, Math.sin(a) * r, 0.0);
                else p = center.add(0.0, Math.cos(a) * r, Math.sin(a) * r);

                sendDust(level, p,
                        plane == 1 ? new Vector3f(0.00f, 0.70f, 1.0f) : new Vector3f(0.02f, 0.42f, 1.0f),
                        (float) (0.48 + 0.18 * fadeFactor));
            }
        }

        int wisps = Math.max(2, (int) (8 * fadeFactor));
        for (int i = 0; i < wisps; i++) {
            double a = rnd(0.0, Math.PI * 2.0);
            double h = rnd(-radius * 0.85, radius * 0.85);
            double r = radius * rnd(1.18, 1.58);
            Vec3 p = center.add(Math.cos(a) * r, h, Math.sin(a) * r);
            sendDust(level, p, new Vector3f(0.00f, 0.72f, 1.0f), 0.52f);
        }
    }

    private static boolean canMaximumBlueConsume(ServerLevel level, ServerPlayer owner, BlockPos pos) {
        BlockState state = level.getBlockState(pos);
        if (state.isAir()) return false;
        if (state.hasBlockEntity()) return false;
        if (!state.getFluidState().isEmpty()) return false;
        if (state.getDestroySpeed(level, pos) < 0.0F) return false;
        if (state.is(Blocks.MOVING_PISTON) || state.is(Blocks.END_PORTAL) || state.is(Blocks.NETHER_PORTAL)) return false;

        return !isOwnerSafeBlock(owner, pos);
    }

    private static void pullMaximumBlueBlocks(ServerPlayer owner, ServerLevel level, Vec3 center, long now) {
        if (now % 3 != 0) return;

        List<BlockPos> candidates = new ArrayList<>();
        int minX = Mth.floor(center.x - MAX_BLUE_ZONE_HALF);
        int maxX = Mth.floor(center.x + MAX_BLUE_ZONE_HALF);
        int minY = Mth.floor(center.y - MAX_BLUE_ZONE_HALF);
        int maxY = Mth.floor(center.y + MAX_BLUE_ZONE_HALF);
        int minZ = Mth.floor(center.z - MAX_BLUE_ZONE_HALF);
        int maxZ = Mth.floor(center.z + MAX_BLUE_ZONE_HALF);

        for (int x = minX; x <= maxX; x++) {
            for (int y = minY; y <= maxY; y++) {
                for (int z = minZ; z <= maxZ; z++) {
                    BlockPos pos = new BlockPos(x, y, z);
                    Vec3 bc = Vec3.atCenterOf(pos);
                    if (Math.abs(bc.x - center.x) > MAX_BLUE_ZONE_HALF ||
                            Math.abs(bc.y - center.y) > MAX_BLUE_ZONE_HALF ||
                            Math.abs(bc.z - center.z) > MAX_BLUE_ZONE_HALF) continue;
                    if (canMaximumBlueConsume(level, owner, pos)) candidates.add(pos.immutable());
                }
            }
        }

        candidates.sort(Comparator.comparingDouble(p -> Vec3.atCenterOf(p).distanceToSqr(center)));

        int count = Math.min(3, candidates.size());
        if (count <= 0) return;

        List<MaxBlueSuctionBlock> active = MAX_BLUE_SUCTION.computeIfAbsent(owner.getUUID(), id -> new ArrayList<>());

        for (int i = 0; i < count; i++) {
            BlockPos pos = candidates.get(i);
            BlockState state = level.getBlockState(pos);

            FallingBlockEntity falling = FallingBlockEntity.fall(level, pos, state);
            falling.setNoGravity(true);
            falling.noPhysics = true;
            falling.setDeltaMovement(Vec3.ZERO);
            falling.fallDistance = 0.0F;

            active.add(new MaxBlueSuctionBlock(
                    falling.getId(), Vec3.atCenterOf(pos), now, rnd(0.0, Math.PI * 2.0)));
        }
    }

    private static void tickMaximumBlueSuction(ServerPlayer owner, ServerLevel level, Vec3 center, long now) {
        List<MaxBlueSuctionBlock> active = MAX_BLUE_SUCTION.get(owner.getUUID());
        if (active == null || active.isEmpty()) return;

        active.removeIf(entry -> {
            Entity entity = level.getEntity(entry.entityId);
            if (!(entity instanceof FallingBlockEntity falling) || !entity.isAlive()) return true;

            double t = Mth.clamp((now - entry.startTick) / 24.0, 0.0, 1.0);
            Vec3 target;

            if (t < 0.45) {
                double q = maxBlueSmooth(t / 0.45);
                double angle = entry.phaseOffset + q * Math.PI * 0.85;
                Vec3 orbitEntry = center.add(
                        Math.cos(angle) * (MAX_BLUE_RADIUS + 1.15),
                        Math.sin(angle * 1.7) * 1.1,
                        Math.sin(angle) * (MAX_BLUE_RADIUS + 1.15));
                Vec3 liftedStart = entry.start.add(0.0, Math.sin(q * Math.PI) * 1.25, 0.0);
                target = liftedStart.lerp(orbitEntry, q);
            } else if (t < 0.82) {
                double q = (t - 0.45) / 0.37;
                double angle = entry.phaseOffset + Math.PI * 0.85 + q * Math.PI * 2.25;
                double r = (MAX_BLUE_RADIUS + 1.15) * (1.0 - q) + (MAX_BLUE_RADIUS + 0.15) * q;
                target = center.add(
                        Math.cos(angle) * r,
                        Math.sin(angle * 1.35) * (0.95 - q * 0.45),
                        Math.sin(angle) * r);
            } else {
                double q = maxBlueSmooth((t - 0.82) / 0.18);
                double angle = entry.phaseOffset + Math.PI * 3.10;
                Vec3 orbitPoint = center.add(
                        Math.cos(angle) * (MAX_BLUE_RADIUS + 0.15),
                        Math.sin(angle * 1.35) * 0.50,
                        Math.sin(angle) * (MAX_BLUE_RADIUS + 0.15));
                target = orbitPoint.lerp(center, q);
            }

            falling.setPos(target.x, target.y, target.z);
            falling.setDeltaMovement(Vec3.ZERO);
            falling.setNoGravity(true);
            falling.noPhysics = true;
            falling.fallDistance = 0.0F;

            if (now % 2 == 0) {
                sendDust(level,
                        target.add(rnd(-0.12, 0.12), rnd(-0.12, 0.12), rnd(-0.12, 0.12)),
                        new Vector3f(0.02f, 0.60f, 1.0f), 0.44f);
            }

            if (t >= 1.0) {
                falling.discard();
                return true;
            }
            return false;
        });

        if (active.isEmpty()) MAX_BLUE_SUCTION.remove(owner.getUUID());
    }

    private static void damageMaximumBlueZone(ServerPlayer owner, ServerLevel level, Vec3 center, long now) {
        AABB zone = new AABB(
                center.x - MAX_BLUE_ZONE_HALF, center.y - MAX_BLUE_ZONE_HALF, center.z - MAX_BLUE_ZONE_HALF,
                center.x + MAX_BLUE_ZONE_HALF, center.y + MAX_BLUE_ZONE_HALF, center.z + MAX_BLUE_ZONE_HALF);

        String suffix = owner.getUUID().toString().replace("-", "");
        String seenKey = "jn_mb_seen_" + suffix;
        String hitKey = "jn_mb_hit_" + suffix;

        List<LivingEntity> targets = level.getEntitiesOfClass(
                LivingEntity.class, zone,
                e -> e.isAlive() && e != owner && !e.isSpectator());

        for (LivingEntity target : targets) {
            long lastSeen = target.getPersistentData().getLong(seenKey);
            long lastHit = target.getPersistentData().getLong(hitKey);

            if (lastSeen < now - 1 || now - lastHit >= 20) {
                target.hurt(level.damageSources().playerAttack(owner), MAX_BLUE_DAMAGE);
                target.getPersistentData().putLong(hitKey, now);

                Vec3 p = target.position().add(0.0, target.getBbHeight() * 0.5, 0.0);
                for (int i = 0; i < 8; i++) {
                    sendDust(level,
                            p.add(rnd(-0.35, 0.35), rnd(-0.35, 0.35), rnd(-0.35, 0.35)),
                            new Vector3f(0.02f, 0.72f, 1.0f), 0.62f);
                }
            }

            target.getPersistentData().putLong(seenKey, now);
        }
    }

    private static void freezeMaximumBlueOwner(ServerPlayer player) {
        double x = player.getPersistentData().getDouble("jn_max_blue_lock_x");
        double y = player.getPersistentData().getDouble("jn_max_blue_lock_y");
        double z = player.getPersistentData().getDouble("jn_max_blue_lock_z");

        player.teleportTo(x, y, z);
        player.setDeltaMovement(Vec3.ZERO);
        player.setSprinting(false);
        player.fallDistance = 0.0F;
    }

    private static void tickMaximumBlueState(ServerPlayer player, ServerLevel level, long now) {
        int phase = player.getPersistentData().getInt("jn_max_blue_phase");
        if (phase == MAX_BLUE_PHASE_NONE) return;

        if (!player.isAlive() || !hasGojoBlindfold(player)) {
            clearMaximumBlue(player);
            return;
        }

        freezeMaximumBlueOwner(player);

        Vec3 center = currentMaximumBlueCenter(player, now);
        double radius = currentMaximumBlueRadius(player, now);
        player.getPersistentData().putDouble("jn_max_blue_x", center.x);
        player.getPersistentData().putDouble("jn_max_blue_y", center.y);
        player.getPersistentData().putDouble("jn_max_blue_z", center.z);

        double fadeFactor = 1.0;
        if (phase == MAX_BLUE_PHASE_FADING) {
            long fadeStart = player.getPersistentData().getLong("jn_max_blue_phase_start");
            fadeFactor = 1.0 - Mth.clamp((now - fadeStart) / (double) MAX_BLUE_FADE_TICKS, 0.0, 1.0);
        }

        spawnMaximumBlueVisual(level, center, radius, now, fadeFactor);
        tickMaximumBlueSuction(player, level, center, now);

        if (phase == MAX_BLUE_PHASE_FORMING) {
            long start = player.getPersistentData().getLong("jn_max_blue_phase_start");
            if (now - start >= MAX_BLUE_FORM_TICKS) {
                player.getPersistentData().putInt("jn_max_blue_phase", MAX_BLUE_PHASE_ACTIVE);
                player.getPersistentData().putLong("jn_max_blue_phase_start", now);
                playSfx(level, player, SFX_MAX_BLUE, 1.30f, 0.76f);
                player.displayClientMessage(
                        Component.literal("MAXIMUM BLUE // ACTIVE")
                                .withStyle(ChatFormatting.AQUA, ChatFormatting.BOLD), true);
            }
            return;
        }

        if (phase == MAX_BLUE_PHASE_ACTIVE) {
            damageMaximumBlueZone(player, level, center, now);
            pullMaximumBlueBlocks(player, level, center, now);

            long activeStart = player.getPersistentData().getLong("jn_max_blue_phase_start");
            if (now - activeStart >= MAX_BLUE_ACTIVE_TICKS) beginMaximumBlueFade(player);
            else if (now % 40 == 0) playSfx(level, player, SFX_MAX_BLUE, 0.40f, 0.70f);
            return;
        }

        if (phase == MAX_BLUE_PHASE_FADING) {
            long fadeStart = player.getPersistentData().getLong("jn_max_blue_phase_start");
            if (now - fadeStart >= MAX_BLUE_FADE_TICKS) clearMaximumBlue(player);
        }
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


    private static final int RED_MODE_NONE = 0;
    private static final int RED_MODE_CHARGING = 1;
    private static final int RED_MODE_PROJECTILE = 2;
    private static final int RED_MODE_MAX_PROJECTILE = 3;

    private static final double RED_MAX_DISTANCE = 75.0;
    private static final double RED_SPEED = 3.75;
    private static final double RED_BALL_RADIUS = 0.22; // диаметр ~0.44 блока
    private static final float RED_DAMAGE = 50.0F; // 25 сердец
    private static final float RED_EXPLOSION_POWER = 6.0F;

    // Maximum Red.
    private static final long MAX_RED_TRANSFORM_TICKS = 40L; // 2 сек
    private static final long MAX_RED_AUTO_FIRE_TICKS = 100L; // 5 сек
    private static final double MAX_RED_SPEED = 2.0; // чуть медленнее обычного Red
    private static final double MAX_RED_BALL_RADIUS = 0.50; // сам шар ~1 блок
    private static final double MAX_RED_SAFE_DISTANCE = 4.0;
    private static final double MAX_RED_FULL_DISTANCE = 40.0;
    private static final double MAX_RED_SHRINK_DISTANCE = 10.0;
    private static final double MAX_RED_END_DISTANCE = MAX_RED_FULL_DISTANCE + MAX_RED_SHRINK_DISTANCE;
    private static final double MAX_RED_TUNNEL_RADIUS = 7.0; // именно радиус
    private static final double MAX_RED_END_RADIUS = 2.0;
    private static final float MAX_RED_DAMAGE = 100.0F; // 50 сердец

    // Ограничиваем количество world-updates за тик, чтобы вырезание тоннеля не роняло TPS.
    private static final int MAX_RED_BLOCK_BUDGET_PER_TICK = 160;
    private static final double MAX_RED_SLICE_STEP = 0.72;
    private static final double MAX_RED_DISK_STEP = 0.78;
    private static final int MAX_RED_BLOCK_UPDATE_FLAGS = 2 | 16 | 32;

    private static final Map<UUID, MaximumRedRuntime> MAX_RED_RUNTIMES = new HashMap<>();

    private static class MaximumRedRuntime {
        final ArrayDeque<BlockPos> destructionQueue = new ArrayDeque<>();
        final Set<Long> visitedBlocks = new HashSet<>();
        final Set<UUID> damagedEntities = new HashSet<>();
        final Vec3 direction;
        final Vec3 right;
        final Vec3 up;

        double nextSliceDistance = MAX_RED_SAFE_DISTANCE;
        int destroyedBlocks = 0;
        boolean projectileActive = true;

        MaximumRedRuntime(Vec3 direction) {
            this.direction = direction.normalize();

            Vec3 reference = Math.abs(this.direction.y) > 0.92
                    ? new Vec3(1.0, 0.0, 0.0)
                    : new Vec3(0.0, 1.0, 0.0);

            Vec3 computedRight = this.direction.cross(reference);
            if (computedRight.lengthSqr() < 1.0E-6) computedRight = new Vec3(1.0, 0.0, 0.0);

            this.right = computedRight.normalize();
            this.up = this.right.cross(this.direction).normalize();
        }
    }

    private static void spawnRedSphere(ServerLevel level, Vec3 center, double radius) {
        final int shellPoints = 74;
        final double golden = Math.PI * (3.0 - Math.sqrt(5.0));

        for (int i = 0; i < shellPoints; i++) {
            double y = 1.0 - (i / (double) (shellPoints - 1)) * 2.0;
            double ring = Math.sqrt(Math.max(0.0, 1.0 - y * y));
            double theta = golden * i;

            Vec3 p = center.add(
                    Math.cos(theta) * ring * radius,
                    y * radius,
                    Math.sin(theta) * ring * radius
            );

            sendDust(
                    level,
                    p,
                    i % 3 == 0
                            ? new Vector3f(1.0f, 0.00f, 0.05f)
                            : new Vector3f(0.72f, 0.00f, 0.03f),
                    i % 3 == 0 ? 0.72f : 0.56f
            );
        }

        for (int i = 0; i < 12; i++) {
            double theta = rnd(0.0, Math.PI * 2.0);
            double phi = Math.acos(rnd(-1.0, 1.0));
            double r = radius * rnd(1.05, 1.38);

            Vec3 p = center.add(
                    Math.sin(phi) * Math.cos(theta) * r,
                    Math.cos(phi) * r,
                    Math.sin(phi) * Math.sin(theta) * r
            );

            sendDust(level, p, new Vector3f(0.95f, 0.00f, 0.04f), 0.48f);
        }
    }

    private static void spawnMaximumRedVisual(
            ServerLevel level,
            Vec3 center,
            Vec3 direction,
            double ballRadius,
            long now,
            boolean charging
    ) {
        double golden = Math.PI * (3.0 - Math.sqrt(5.0));

        // Плотное красное ядро. Частиц меньше, чем у обычного Red,
        // чтобы большой VFX оставался дешёвым для сети.
        for (int i = 0; i < 34; i++) {
            double y = 1.0 - (i / 33.0) * 2.0;
            double ring = Math.sqrt(Math.max(0.0, 1.0 - y * y));
            double theta = golden * i + now * 0.08;

            Vec3 p = center.add(
                    Math.cos(theta) * ring * ballRadius,
                    y * ballRadius,
                    Math.sin(theta) * ring * ballRadius
            );

            sendDust(
                    level,
                    p,
                    i % 4 == 0
                            ? new Vector3f(1.0f, 0.02f, 0.06f)
                            : new Vector3f(0.60f, 0.00f, 0.02f),
                    i % 4 == 0 ? 0.90f : 0.68f
            );
        }

        Vec3 reference = Math.abs(direction.y) > 0.92
                ? new Vec3(1.0, 0.0, 0.0)
                : new Vec3(0.0, 1.0, 0.0);

        Vec3 right = direction.cross(reference);
        if (right.lengthSqr() < 1.0E-6) right = new Vec3(1.0, 0.0, 0.0);
        right = right.normalize();
        Vec3 up = right.cross(direction).normalize();

        // Несколько вращающихся колец/дуг вокруг шара.
        for (int ringIndex = 0; ringIndex < 3; ringIndex++) {
            double orbitRadius = ballRadius * (1.55 + ringIndex * 0.34);
            double spin = now * (0.13 + ringIndex * 0.035) + ringIndex * 2.1;

            for (int i = 0; i < 16; i++) {
                double a = Math.PI * 2.0 * i / 16.0 + spin;
                Vec3 ringRight = right.scale(Math.cos(a) * orbitRadius);
                Vec3 ringUp = up.scale(Math.sin(a) * orbitRadius);

                // Каждое кольцо слегка наклонено относительно предыдущего.
                Vec3 p = center
                        .add(ringRight)
                        .add(ringUp)
                        .add(direction.scale(Math.sin(a + ringIndex) * 0.18 * ringIndex));

                sendDust(
                        level,
                        p,
                        ringIndex == 1
                                ? new Vector3f(1.0f, 0.02f, 0.08f)
                                : new Vector3f(0.72f, 0.00f, 0.025f),
                        0.62f
                );
            }
        }

        // Красные энергетические нити и вихрь позади ядра.
        for (int i = 0; i < 9; i++) {
            double angle = now * 0.18 + i * (Math.PI * 2.0 / 9.0);
            double r = ballRadius * rnd(1.15, 2.15);
            double back = charging ? rnd(-0.20, 0.20) : rnd(-1.30, -0.20);

            Vec3 p = center
                    .add(right.scale(Math.cos(angle) * r))
                    .add(up.scale(Math.sin(angle) * r))
                    .add(direction.scale(back));

            sendDust(level, p, new Vector3f(0.92f, 0.00f, 0.035f), 0.54f);
        }

        if (now % 2 == 0) {
            spawnVfx(level, VFX_RED, center, 1);
        }
    }

    private static Vec3 redHeldPosition(ServerPlayer player) {
        return player.getEyePosition()
                .add(player.getLookAngle().normalize().scale(1.45))
                .add(0.0, -0.08, 0.0);
    }

    private static boolean startRedCharge(ServerPlayer player) {
        if (player == null || !player.isAlive() || player.isSpectator()) return false;

        if (!hasGojoBlindfold(player)) {
            requireBlindfoldMessage(player);
            return false;
        }

        if (player.getPersistentData().getInt("jn_red_mode") != RED_MODE_NONE) {
            return false;
        }

        long now = player.level().getGameTime();
        long cooldownUntil = player.getPersistentData().getLong("jn_cd_red");

        if (now < cooldownUntil) {
            long ticksLeft = cooldownUntil - now;
            double seconds = Math.ceil(ticksLeft / 2.0) / 10.0;
            player.displayClientMessage(
                    Component.literal("Перезарядка Red: " + seconds + " сек.")
                            .withStyle(ChatFormatting.GRAY),
                    true
            );
            return false;
        }

        double cost = abilityCost(player, Ability.RED);
        if (!consumeEnergy(player, cost)) return false;

        player.getPersistentData().putInt("jn_red_mode", RED_MODE_CHARGING);
        player.getPersistentData().putBoolean("jn_red_energy_reserved", true);
        player.getPersistentData().putBoolean("jn_red_max_ready", false);
        player.getPersistentData().putLong("jn_red_started", now);

        Vec3 center = redHeldPosition(player);
        spawnRedSphere(player.serverLevel(), center, RED_BALL_RADIUS);
        playSfx(player.serverLevel(), player, SFX_RED, 0.78f, 1.06f);
        handSign(player);

        return true;
    }

    private static void cancelRedCharge(ServerPlayer player, boolean refundEnergy) {
        int mode = player.getPersistentData().getInt("jn_red_mode");
        if (mode != RED_MODE_CHARGING) return;

        if (refundEnergy && player.getPersistentData().getBoolean("jn_red_energy_reserved")) {
            setEnergy(player, getEnergy(player) + abilityCost(player, Ability.RED));
        }

        player.getPersistentData().putInt("jn_red_mode", RED_MODE_NONE);
        player.getPersistentData().remove("jn_red_energy_reserved");
        player.getPersistentData().remove("jn_red_max_ready");
        player.getPersistentData().remove("jn_red_started");
    }

    private static void launchNormalRed(ServerPlayer player) {
        if (player.getPersistentData().getInt("jn_red_mode") != RED_MODE_CHARGING) return;

        Vec3 pos = redHeldPosition(player);
        Vec3 velocity = player.getLookAngle().normalize().scale(RED_SPEED);

        player.getPersistentData().putInt("jn_red_mode", RED_MODE_PROJECTILE);
        player.getPersistentData().putDouble("jn_red_x", pos.x);
        player.getPersistentData().putDouble("jn_red_y", pos.y);
        player.getPersistentData().putDouble("jn_red_z", pos.z);
        player.getPersistentData().putDouble("jn_red_vx", velocity.x);
        player.getPersistentData().putDouble("jn_red_vy", velocity.y);
        player.getPersistentData().putDouble("jn_red_vz", velocity.z);
        player.getPersistentData().putDouble("jn_red_distance", 0.0);
        player.getPersistentData().remove("jn_red_energy_reserved");
        player.getPersistentData().remove("jn_red_max_ready");
        player.getPersistentData().remove("jn_red_started");

        setCooldown(player, Ability.RED, 140);
        playSfx(player.serverLevel(), player, SFX_RED, 1.15f, 0.92f);
    }

    private static void launchMaximumRed(ServerPlayer player) {
        if (player.getPersistentData().getInt("jn_red_mode") != RED_MODE_CHARGING) return;

        ServerLevel level = player.serverLevel();
        Vec3 pos = redHeldPosition(player);
        Vec3 direction = player.getLookAngle().normalize();
        Vec3 velocity = direction.scale(MAX_RED_SPEED);

        player.getPersistentData().putInt("jn_red_mode", RED_MODE_MAX_PROJECTILE);
        player.getPersistentData().putDouble("jn_red_x", pos.x);
        player.getPersistentData().putDouble("jn_red_y", pos.y);
        player.getPersistentData().putDouble("jn_red_z", pos.z);
        player.getPersistentData().putDouble("jn_red_vx", velocity.x);
        player.getPersistentData().putDouble("jn_red_vy", velocity.y);
        player.getPersistentData().putDouble("jn_red_vz", velocity.z);

        // Считаем расстояние от владельца, а не от стартовой позиции шара.
        double initialDistance = player.getEyePosition().distanceTo(pos);
        player.getPersistentData().putDouble("jn_red_distance", initialDistance);

        player.getPersistentData().remove("jn_red_energy_reserved");
        player.getPersistentData().remove("jn_red_max_ready");
        player.getPersistentData().remove("jn_red_started");

        MAX_RED_RUNTIMES.put(player.getUUID(), new MaximumRedRuntime(direction));

        setCooldown(player, Ability.RED, 140);

        playSfx(level, player, SFX_RED, 1.48f, 0.62f);
        spawnStylizedShockwave(level, pos, 2.8, new Vector3f(1.0f, 0.00f, 0.05f));

        player.displayClientMessage(
                Component.literal("MAXIMUM RED")
                        .withStyle(ChatFormatting.RED, ChatFormatting.BOLD),
                true
        );
    }

    private static void releaseRedCharge(ServerPlayer player) {
        if (player.getPersistentData().getInt("jn_red_mode") != RED_MODE_CHARGING) return;

        long now = player.level().getGameTime();
        long started = player.getPersistentData().getLong("jn_red_started");
        long heldTicks = Math.max(0L, now - started);

        if (heldTicks >= MAX_RED_TRANSFORM_TICKS ||
                player.getPersistentData().getBoolean("jn_red_max_ready")) {
            launchMaximumRed(player);
        } else {
            launchNormalRed(player);
        }
    }

    private static void clearRedProjectile(ServerPlayer player) {
        int previousMode = player.getPersistentData().getInt("jn_red_mode");

        if (previousMode == RED_MODE_MAX_PROJECTILE) {
            MaximumRedRuntime runtime = MAX_RED_RUNTIMES.get(player.getUUID());
            if (runtime != null) runtime.projectileActive = false;
        }

        player.getPersistentData().putInt("jn_red_mode", RED_MODE_NONE);
        player.getPersistentData().remove("jn_red_x");
        player.getPersistentData().remove("jn_red_y");
        player.getPersistentData().remove("jn_red_z");
        player.getPersistentData().remove("jn_red_vx");
        player.getPersistentData().remove("jn_red_vy");
        player.getPersistentData().remove("jn_red_vz");
        player.getPersistentData().remove("jn_red_distance");
        player.getPersistentData().remove("jn_red_energy_reserved");
        player.getPersistentData().remove("jn_red_max_ready");
        player.getPersistentData().remove("jn_red_started");
    }

    private static LivingEntity findRedEntityHit(
            ServerLevel level,
            ServerPlayer owner,
            Vec3 from,
            Vec3 to
    ) {
        AABB sweep = new AABB(from, to).inflate(RED_BALL_RADIUS + 0.55);

        return level.getEntitiesOfClass(
                        LivingEntity.class,
                        sweep,
                        e -> e.isAlive() && e != owner && !e.isSpectator()
                )
                .stream()
                .filter(e -> e.getBoundingBox()
                        .inflate(RED_BALL_RADIUS + 0.25)
                        .clip(from, to)
                        .isPresent())
                .min(Comparator.comparingDouble(e -> from.distanceToSqr(e.getBoundingBox().getCenter())))
                .orElse(null);
    }

    private static void explodeRed(ServerPlayer owner, Vec3 center) {
        ServerLevel level = owner.serverLevel();

        List<LivingEntity> victims = level.getEntitiesOfClass(
                LivingEntity.class,
                new AABB(center, center).inflate(6.25),
                e -> e.isAlive() && e != owner
        );

        Map<BlockPos, BlockState> redOwnerSafe = snapshotOwnerSafeBlocks(owner);

        owner.getPersistentData().putBoolean("jn_red_explosion_blocks_only", true);
        try {
            level.explode(
                    owner,
                    center.x, center.y, center.z,
                    RED_EXPLOSION_POWER,
                    false,
                    Level.ExplosionInteraction.TNT
            );
        } finally {
            owner.getPersistentData().putBoolean("jn_red_explosion_blocks_only", false);
            restoreOwnerSafeBlocks(owner, redOwnerSafe);
        }

        owner.getPersistentData().putBoolean("jn_red_custom_damage", true);
        try {
            for (LivingEntity victim : victims) {
                if (!victim.isAlive()) continue;
                victim.hurt(level.damageSources().playerAttack(owner), RED_DAMAGE);
            }
        } finally {
            owner.getPersistentData().putBoolean("jn_red_custom_damage", false);
        }

        for (int ring = 0; ring < 4; ring++) {
            double radius = 1.4 + ring * 1.25;
            int points = 54 + ring * 10;

            for (int i = 0; i < points; i++) {
                double a = Math.PI * 2.0 * i / points;
                Vec3 p = center.add(
                        Math.cos(a) * radius,
                        Math.sin(a * 3.0) * 0.18,
                        Math.sin(a) * radius
                );
                sendDust(
                        level,
                        p,
                        ring % 2 == 0
                                ? new Vector3f(1.0f, 0.00f, 0.04f)
                                : new Vector3f(0.64f, 0.00f, 0.02f),
                        1.15f
                );
            }
        }

        for (int i = 0; i < 72; i++) {
            Vec3 dir = new Vec3(
                    rnd(-1.0, 1.0),
                    rnd(-0.65, 0.85),
                    rnd(-1.0, 1.0)
            );
            if (dir.lengthSqr() < 1.0E-4) continue;
            dir = dir.normalize().scale(rnd(0.8, 4.4));
            sendDust(
                    level,
                    center.add(dir),
                    new Vector3f(0.92f, 0.00f, 0.035f),
                    0.95f
            );
        }

        playSfx(level, owner, SFX_RED, 1.35f, 0.72f);
        level.playSound(
                null,
                center.x, center.y, center.z,
                SoundEvents.GENERIC_EXPLODE,
                SoundSource.PLAYERS,
                1.6f,
                0.78f
        );

        clearRedProjectile(owner);
    }

    private static double maximumRedTunnelRadius(double travelled) {
        if (travelled < MAX_RED_SAFE_DISTANCE) return 0.0;
        if (travelled <= MAX_RED_FULL_DISTANCE) return MAX_RED_TUNNEL_RADIUS;
        if (travelled >= MAX_RED_END_DISTANCE) return MAX_RED_END_RADIUS;

        double t = (travelled - MAX_RED_FULL_DISTANCE) / MAX_RED_SHRINK_DISTANCE;
        t = Mth.clamp(t, 0.0, 1.0);

        return MAX_RED_TUNNEL_RADIUS +
                (MAX_RED_END_RADIUS - MAX_RED_TUNNEL_RADIUS) * t;
    }

    private static boolean canMaximumRedAnnihilate(
            ServerPlayer owner,
            ServerLevel level,
            BlockPos pos,
            BlockState state
    ) {
        if (state.isAir() && state.getFluidState().isEmpty()) return false;
        if (isOwnerSafeBlock(owner, pos)) return false;

        // Воду/лаву удаляем независимо от твёрдости их BlockState.
        if (!state.getFluidState().isEmpty()) return true;

        // Bedrock, barrier, portal frame и остальные технически неразрушимые блоки пропускаем.
        return state.getDestroySpeed(level, pos) >= 0.0F;
    }

    private static void enqueueMaximumRedSlice(
            ServerPlayer owner,
            ServerLevel level,
            MaximumRedRuntime runtime,
            Vec3 center,
            double radius
    ) {
        if (radius <= 0.0) return;

        double paddedRadius = radius + 0.32;
        double radiusSq = paddedRadius * paddedRadius;

        for (double a = -paddedRadius; a <= paddedRadius + 1.0E-6; a += MAX_RED_DISK_STEP) {
            for (double b = -paddedRadius; b <= paddedRadius + 1.0E-6; b += MAX_RED_DISK_STEP) {
                if (a * a + b * b > radiusSq) continue;

                Vec3 sample = center
                        .add(runtime.right.scale(a))
                        .add(runtime.up.scale(b));

                BlockPos pos = BlockPos.containing(sample);

                if (!level.hasChunkAt(pos)) continue;

                long key = pos.asLong();
                if (!runtime.visitedBlocks.add(key)) continue;

                BlockState state = level.getBlockState(pos);
                if (!canMaximumRedAnnihilate(owner, level, pos, state)) continue;

                runtime.destructionQueue.addLast(pos.immutable());
            }
        }
    }

    private static void scheduleMaximumRedTunnel(
            ServerPlayer owner,
            ServerLevel level,
            MaximumRedRuntime runtime,
            Vec3 segmentStart,
            Vec3 segmentEnd,
            double startDistance,
            double endDistance
    ) {
        if (endDistance < MAX_RED_SAFE_DISTANCE) return;

        double segmentLength = segmentStart.distanceTo(segmentEnd);
        if (segmentLength < 1.0E-5) return;

        while (runtime.nextSliceDistance <= endDistance + 1.0E-6 &&
                runtime.nextSliceDistance <= MAX_RED_END_DISTANCE + 1.0E-6) {

            if (runtime.nextSliceDistance + 1.0E-6 < startDistance) {
                runtime.nextSliceDistance += MAX_RED_SLICE_STEP;
                continue;
            }

            double local = (runtime.nextSliceDistance - startDistance) / segmentLength;
            local = Mth.clamp(local, 0.0, 1.0);

            Vec3 center = segmentStart.lerp(segmentEnd, local);
            double radius = maximumRedTunnelRadius(runtime.nextSliceDistance);

            enqueueMaximumRedSlice(owner, level, runtime, center, radius);
            runtime.nextSliceDistance += MAX_RED_SLICE_STEP;
        }
    }

    private static double pointSegmentDistanceSqr(Vec3 point, Vec3 a, Vec3 b) {
        Vec3 ab = b.subtract(a);
        double lenSq = ab.lengthSqr();

        if (lenSq < 1.0E-8) return point.distanceToSqr(a);

        double t = point.subtract(a).dot(ab) / lenSq;
        t = Mth.clamp(t, 0.0, 1.0);

        return point.distanceToSqr(a.add(ab.scale(t)));
    }

    private static void damageMaximumRedSegment(
            ServerPlayer owner,
            ServerLevel level,
            MaximumRedRuntime runtime,
            Vec3 from,
            Vec3 to,
            double radius
    ) {
        if (radius <= 0.0) return;

        AABB search = new AABB(from, to).inflate(radius + 1.0);

        List<LivingEntity> targets = level.getEntitiesOfClass(
                LivingEntity.class,
                search,
                e -> e.isAlive() && e != owner && !e.isSpectator()
        );

        for (LivingEntity target : targets) {
            if (runtime.damagedEntities.contains(target.getUUID())) continue;

            Vec3 targetCenter = target.position().add(0.0, target.getBbHeight() * 0.5, 0.0);
            double allowance = Math.max(0.25, target.getBbWidth() * 0.5);
            double hitRadius = radius + allowance;

            if (pointSegmentDistanceSqr(targetCenter, from, to) > hitRadius * hitRadius) continue;

            runtime.damagedEntities.add(target.getUUID());

            owner.getPersistentData().putBoolean("jn_red_custom_damage", true);
            try {
                target.hurt(level.damageSources().playerAttack(owner), MAX_RED_DAMAGE);
            } finally {
                owner.getPersistentData().putBoolean("jn_red_custom_damage", false);
            }

            Vec3 impact = targetCenter;
            for (int i = 0; i < 16; i++) {
                sendDust(
                        level,
                        impact.add(rnd(-0.55, 0.55), rnd(-0.55, 0.55), rnd(-0.55, 0.55)),
                        new Vector3f(1.0f, 0.00f, 0.04f),
                        0.82f
                );
            }
        }
    }

    private static void processMaximumRedDestructionQueue(
            ServerPlayer owner,
            ServerLevel level
    ) {
        MaximumRedRuntime runtime = MAX_RED_RUNTIMES.get(owner.getUUID());
        if (runtime == null) return;

        int budget = MAX_RED_BLOCK_BUDGET_PER_TICK;

        while (budget-- > 0 && !runtime.destructionQueue.isEmpty()) {
            BlockPos pos = runtime.destructionQueue.pollFirst();
            if (pos == null || !level.hasChunkAt(pos)) continue;

            BlockState state = level.getBlockState(pos);
            if (!canMaximumRedAnnihilate(owner, level, pos, state)) continue;

            // UPDATE_CLIENTS + UPDATE_KNOWN_SHAPE + UPDATE_SUPPRESS_DROPS.
            // Без массового cascade neighbor-update на тысячи блоков.
            level.setBlock(
                    pos,
                    Blocks.AIR.defaultBlockState(),
                    MAX_RED_BLOCK_UPDATE_FLAGS
            );

            runtime.destroyedBlocks++;

            // Редкий VFX на месте аннигиляции. Не шлём частицу на каждый блок.
            if ((runtime.destroyedBlocks & 15) == 0) {
                Vec3 p = Vec3.atCenterOf(pos);
                for (int i = 0; i < 3; i++) {
                    sendDust(
                            level,
                            p.add(rnd(-0.28, 0.28), rnd(-0.28, 0.28), rnd(-0.28, 0.28)),
                            new Vector3f(0.78f, 0.00f, 0.025f),
                            0.46f
                    );
                }
            }
        }

        if (!runtime.projectileActive && runtime.destructionQueue.isEmpty()) {
            MAX_RED_RUNTIMES.remove(owner.getUUID());
        }
    }

    private static void dissolveMaximumRed(
            ServerPlayer owner,
            ServerLevel level,
            Vec3 center
    ) {
        MaximumRedRuntime runtime = MAX_RED_RUNTIMES.get(owner.getUUID());
        if (runtime != null) runtime.projectileActive = false;

        for (int i = 0; i < 44; i++) {
            double theta = rnd(0.0, Math.PI * 2.0);
            double phi = Math.acos(rnd(-1.0, 1.0));
            double r = rnd(0.25, 2.0);

            Vec3 p = center.add(
                    Math.sin(phi) * Math.cos(theta) * r,
                    Math.cos(phi) * r,
                    Math.sin(phi) * Math.sin(theta) * r
            );

            sendDust(
                    level,
                    p,
                    i % 3 == 0
                            ? new Vector3f(1.0f, 0.00f, 0.05f)
                            : new Vector3f(0.55f, 0.00f, 0.015f),
                    0.62f
            );
        }

        spawnStylizedShockwave(level, center, 1.8, new Vector3f(0.85f, 0.00f, 0.03f));
        clearRedProjectile(owner);
    }

    private static void tickRedState(ServerPlayer player, ServerLevel level, long now) {
        // Очередь продолжает безопасно очищать тоннель даже после исчезновения шара.
        processMaximumRedDestructionQueue(player, level);

        int mode = player.getPersistentData().getInt("jn_red_mode");
        if (mode == RED_MODE_NONE) return;

        if (!player.isAlive() || !hasGojoBlindfold(player)) {
            if (mode == RED_MODE_CHARGING) {
                cancelRedCharge(player, true);
            } else {
                clearRedProjectile(player);
            }
            return;
        }

        if (mode == RED_MODE_CHARGING) {
            long started = player.getPersistentData().getLong("jn_red_started");
            long heldTicks = Math.max(0L, now - started);
            Vec3 center = redHeldPosition(player);
            Vec3 direction = player.getLookAngle().normalize();

            if (heldTicks >= MAX_RED_TRANSFORM_TICKS) {
                if (!player.getPersistentData().getBoolean("jn_red_max_ready")) {
                    player.getPersistentData().putBoolean("jn_red_max_ready", true);
                    playSfx(level, player, SFX_RED, 1.20f, 0.70f);
                    player.displayClientMessage(
                            Component.literal("MAXIMUM RED // READY")
                                    .withStyle(ChatFormatting.RED, ChatFormatting.BOLD),
                            true
                    );
                }

                // За первые полсекунды после превращения шар плавно вырастает до ~1 блока.
                double grow = Mth.clamp(
                        (heldTicks - MAX_RED_TRANSFORM_TICKS) / 10.0,
                        0.0,
                        1.0
                );
                grow = grow * grow * (3.0 - 2.0 * grow);
                double radius = RED_BALL_RADIUS +
                        (MAX_RED_BALL_RADIUS - RED_BALL_RADIUS) * grow;

                spawnMaximumRedVisual(level, center, direction, radius, now, true);

                // Максимум 5 секунд удержания — дальше автоматический выстрел.
                if (heldTicks >= MAX_RED_AUTO_FIRE_TICKS) {
                    launchMaximumRed(player);
                }
            } else {
                spawnRedSphere(level, center, RED_BALL_RADIUS);

                Vec3 eye = player.getEyePosition();
                for (int i = 1; i <= 7; i++) {
                    double t = i / 8.0;
                    Vec3 p = eye.lerp(center, t);
                    sendDust(
                            level,
                            p,
                            i % 2 == 0
                                    ? new Vector3f(1.0f, 0.00f, 0.04f)
                                    : new Vector3f(0.68f, 0.00f, 0.02f),
                            0.58f
                    );
                }
            }
            return;
        }

        Vec3 pos = new Vec3(
                player.getPersistentData().getDouble("jn_red_x"),
                player.getPersistentData().getDouble("jn_red_y"),
                player.getPersistentData().getDouble("jn_red_z")
        );

        Vec3 velocity = new Vec3(
                player.getPersistentData().getDouble("jn_red_vx"),
                player.getPersistentData().getDouble("jn_red_vy"),
                player.getPersistentData().getDouble("jn_red_vz")
        );

        Vec3 next = pos.add(velocity);

        if (mode == RED_MODE_PROJECTILE) {
            BlockHitResult blockHit = level.clip(new ClipContext(
                    pos,
                    next,
                    ClipContext.Block.COLLIDER,
                    ClipContext.Fluid.NONE,
                    player
            ));

            LivingEntity entityHit = findRedEntityHit(level, player, pos, next);

            double blockDist = blockHit.getType() == HitResult.Type.MISS
                    ? Double.POSITIVE_INFINITY
                    : pos.distanceToSqr(blockHit.getLocation());

            double entityDist = entityHit == null
                    ? Double.POSITIVE_INFINITY
                    : pos.distanceToSqr(entityHit.getBoundingBox().getCenter());

            if (blockDist != Double.POSITIVE_INFINITY || entityDist != Double.POSITIVE_INFINITY) {
                Vec3 impact = entityDist < blockDist && entityHit != null
                        ? entityHit.getBoundingBox().getCenter()
                        : blockHit.getLocation();

                explodeRed(player, impact);
                return;
            }

            for (int i = 0; i <= 6; i++) {
                Vec3 trail = pos.lerp(next, i / 6.0);
                sendDust(
                        level,
                        trail,
                        i % 2 == 0
                                ? new Vector3f(1.0f, 0.00f, 0.04f)
                                : new Vector3f(0.62f, 0.00f, 0.02f),
                        0.66f
                );
            }

            spawnRedSphere(level, next, RED_BALL_RADIUS);

            double travelled = player.getPersistentData().getDouble("jn_red_distance") + velocity.length();
            if (travelled >= RED_MAX_DISTANCE) {
                for (int i = 0; i < 34; i++) {
                    Vec3 fade = next.add(
                            rnd(-0.80, 0.80),
                            rnd(-0.80, 0.80),
                            rnd(-0.80, 0.80)
                    );
                    sendDust(level, fade, new Vector3f(0.75f, 0.00f, 0.025f), 0.55f);
                }
                clearRedProjectile(player);
                return;
            }

            player.getPersistentData().putDouble("jn_red_x", next.x);
            player.getPersistentData().putDouble("jn_red_y", next.y);
            player.getPersistentData().putDouble("jn_red_z", next.z);
            player.getPersistentData().putDouble("jn_red_distance", travelled);
            return;
        }

        if (mode == RED_MODE_MAX_PROJECTILE) {
            MaximumRedRuntime runtime = MAX_RED_RUNTIMES.get(player.getUUID());
            if (runtime == null) {
                runtime = new MaximumRedRuntime(velocity);
                MAX_RED_RUNTIMES.put(player.getUUID(), runtime);
            }

            double startDistance = player.getPersistentData().getDouble("jn_red_distance");
            double endDistance = startDistance + velocity.length();

            // Maximum Red НИКОГДА не делает block collision:
            // bedrock/technical blocks просто остаются, шар проходит сквозь них.
            scheduleMaximumRedTunnel(
                    player,
                    level,
                    runtime,
                    pos,
                    next,
                    startDistance,
                    endDistance
            );

            double damageRadius = 0.0;
            if (endDistance >= MAX_RED_SAFE_DISTANCE) {
                double sampleDistance = Math.max(
                        MAX_RED_SAFE_DISTANCE,
                        (startDistance + endDistance) * 0.5
                );
                damageRadius = maximumRedTunnelRadius(sampleDistance);
            }

            if (damageRadius > 0.0) {
                damageMaximumRedSegment(
                        player,
                        level,
                        runtime,
                        pos,
                        next,
                        damageRadius
                );
            }

            spawnMaximumRedVisual(
                    level,
                    next,
                    velocity.normalize(),
                    MAX_RED_BALL_RADIUS,
                    now,
                    false
            );

            // Дополнительный красный след, но без тысяч частиц на тик.
            for (int i = 1; i <= 5; i++) {
                Vec3 trail = pos.lerp(next, i / 6.0);
                sendDust(
                        level,
                        trail,
                        i % 2 == 0
                                ? new Vector3f(1.0f, 0.00f, 0.04f)
                                : new Vector3f(0.52f, 0.00f, 0.015f),
                        0.58f
                );
            }

            if (endDistance >= MAX_RED_END_DISTANCE) {
                dissolveMaximumRed(player, level, next);
                return;
            }

            player.getPersistentData().putDouble("jn_red_x", next.x);
            player.getPersistentData().putDouble("jn_red_y", next.y);
            player.getPersistentData().putDouble("jn_red_z", next.z);
            player.getPersistentData().putDouble("jn_red_distance", endDistance);
        }
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


    private static final int DASH_NONE = 0;
    private static final int DASH_FRONT = 1;
    private static final int DASH_SIDE = 2;
    private static final int DASH_AIR = 3;

    private static final long FRONT_DASH_TICKS = 14L;
    private static final long SIDE_DASH_TICKS = 4L;
    private static final long AIR_DASH_TICKS = 3L;
    private static final float FRONT_DASH_DAMAGE = 16.0F; // 8 сердец

    private static void handleMovement(ServerPlayer player, MovementAction action) {
        if (player == null || !player.isAlive() || player.isSpectator()) return;

        if (action == MovementAction.SPEED_OFF) {
            player.getPersistentData().putBoolean("jn_super_speed", false);
            player.getPersistentData().remove("jn_speed_next_cost");
            player.getPersistentData().remove("jn_speed_last_x");
            player.getPersistentData().remove("jn_speed_last_y");
            player.getPersistentData().remove("jn_speed_last_z");
            return;
        }

        if (!hasGojoBlindfold(player)) {
            player.getPersistentData().putBoolean("jn_super_speed", false);
            if (action != MovementAction.SPEED_ON) requireBlindfoldMessage(player);
            return;
        }

        switch (action) {
            case FRONT_DASH -> startDash(player, 0);
            case LEFT_DASH -> startDash(player, -1);
            case RIGHT_DASH -> startDash(player, 1);
            case SPEED_ON -> {
                player.getPersistentData().putBoolean("jn_super_speed", true);
                player.getPersistentData().putLong("jn_speed_next_cost", player.level().getGameTime() + 40);
                player.getPersistentData().putDouble("jn_speed_last_x", player.getX());
                player.getPersistentData().putDouble("jn_speed_last_y", player.getY());
                player.getPersistentData().putDouble("jn_speed_last_z", player.getZ());
            }
            case SPEED_OFF -> {
                player.getPersistentData().putBoolean("jn_super_speed", false);
                player.getPersistentData().remove("jn_speed_next_cost");
            }
        }
    }

    private static boolean isAirDashHeight(ServerPlayer player) {
        Vec3 start = player.position().add(0.0, 0.05, 0.0);
        Vec3 end = start.add(0.0, -4.15, 0.0);

        BlockHitResult hit = player.level().clip(new ClipContext(
                start,
                end,
                ClipContext.Block.COLLIDER,
                ClipContext.Fluid.NONE,
                player
        ));

        if (hit.getType() == HitResult.Type.MISS) return true;
        return start.y - hit.getLocation().y >= 4.0 - 1.0E-3;
    }

    private static void startDash(ServerPlayer player, int side) {
        if (player.getPersistentData().getInt("jn_dash_mode") != DASH_NONE) return;

        ServerLevel level = player.serverLevel();
        long now = level.getGameTime();

        // В воздухе выше 3 блоков любой Q-рывок становится свободным air dash по камере.
        if (isAirDashHeight(player)) {
            if (!consumeEnergy(player, 0.8)) return;

            Vec3 dir = player.getLookAngle().normalize();
            player.getPersistentData().putInt("jn_dash_mode", DASH_AIR);
            player.getPersistentData().putLong("jn_dash_started", now);
            player.getPersistentData().putDouble("jn_dash_dx", dir.x);
            player.getPersistentData().putDouble("jn_dash_dy", dir.y);
            player.getPersistentData().putDouble("jn_dash_dz", dir.z);

            playSfx(level, player, SFX_DASH, 0.82f, 1.22f);
            spawnVfx(level, VFX_DASH, player.position().add(0, 0.85, 0), 1);
            return;
        }

        long cooldown = player.getPersistentData().getLong("jn_dash_cd");
        if (now < cooldown) return;

        if (!consumeEnergy(player, side == 0 ? 3.0 : 4.0)) return;

        player.getPersistentData().putLong("jn_dash_cd", now + 10);
        player.getPersistentData().putLong("jn_dash_started", now);
        player.getPersistentData().putBoolean("jn_dash_hit", false);

        Vec3 look = player.getLookAngle().normalize();
        Vec3 dir;

        if (side == 0) {
            // Front Dash полностью следует камере, в том числе вверх/вниз.
            dir = look;
            player.getPersistentData().putInt("jn_dash_mode", DASH_FRONT);
        } else {
            Vec3 horizontal = new Vec3(look.x, 0.0, look.z);
            if (horizontal.lengthSqr() < 1.0E-4) {
                double yaw = Math.toRadians(player.getYRot());
                horizontal = new Vec3(-Math.sin(yaw), 0.0, Math.cos(yaw));
            }
            horizontal = horizontal.normalize();
            Vec3 right = new Vec3(-horizontal.z, 0.0, horizontal.x);
            dir = side < 0 ? right.scale(-1.0) : right;
            player.getPersistentData().putInt("jn_dash_mode", DASH_SIDE);
        }

        player.getPersistentData().putDouble("jn_dash_dx", dir.x);
        player.getPersistentData().putDouble("jn_dash_dy", dir.y);
        player.getPersistentData().putDouble("jn_dash_dz", dir.z);

        playSfx(level, player, SFX_DASH, 1.0f, side == 0 ? 0.92f : 1.18f);
        spawnVfx(level, VFX_DASH, player.position().add(0, 0.85, 0), 1);
        spawnVfx(level, VFX_TRAIL, player.position().add(0, 0.85, 0), 1);
    }

    private static boolean tryDashMove(ServerPlayer player, Vec3 delta, boolean allowStepUp) {
        ServerLevel level = player.serverLevel();
        AABB box = player.getBoundingBox();

        if (level.noCollision(player, box.move(delta))) {
            player.move(MoverType.SELF, delta);
            return true;
        }

        if (allowStepUp) {
            for (int h = 1; h <= 2; h++) {
                Vec3 stepped = delta.add(0.0, h, 0.0);
                if (level.noCollision(player, box.move(stepped))) {
                    player.move(MoverType.SELF, stepped);
                    return true;
                }
            }
        }

        return false;
    }

    private static LivingEntity findDashVictim(ServerPlayer player, Vec3 from, Vec3 to) {
        ServerLevel level = player.serverLevel();
        AABB sweep = new AABB(from, to).inflate(0.85);

        return level.getEntitiesOfClass(
                        LivingEntity.class,
                        sweep,
                        e -> e.isAlive() && e != player && !e.isSpectator()
                )
                .stream()
                .filter(e -> e.getBoundingBox().inflate(0.35).clip(from, to).isPresent())
                .min(Comparator.comparingDouble(e -> from.distanceToSqr(e.getBoundingBox().getCenter())))
                .orElse(null);
    }

    private static void spawnFrontDashImpact(ServerPlayer player) {
        ServerLevel level = player.serverLevel();
        Vec3 look = player.getLookAngle().normalize();
        Vec3 origin = player.position().add(0.0, 0.35, 0.0);

        BlockHitResult hit = level.clip(new ClipContext(
                origin,
                origin.add(look.scale(2.4)),
                ClipContext.Block.COLLIDER,
                ClipContext.Fluid.NONE,
                player
        ));

        Vec3 center = hit.getType() == HitResult.Type.MISS
                ? player.position().add(look.scale(0.9)).add(0.0, 0.1, 0.0)
                : hit.getLocation();

        BlockPos bp = hit.getType() == HitResult.Type.MISS
                ? BlockPos.containing(center.x, player.getY() - 0.1, center.z)
                : hit.getBlockPos();

        BlockState state = level.getBlockState(bp);

        // Визуальная "царапина/удар": блоки не ломаются.
        for (int ring = 0; ring < 3; ring++) {
            double radius = 0.45 + ring * 0.42;
            int points = 18 + ring * 8;
            for (int i = 0; i < points; i++) {
                double a = Math.PI * 2.0 * i / points;
                Vec3 p = center.add(
                        Math.cos(a) * radius,
                        rnd(-0.04, 0.10),
                        Math.sin(a) * radius
                );
                sendDust(level, p, new Vector3f(0.72f, 0.88f, 1.0f), 0.50f);
            }
        }

        if (!state.isAir()) {
            level.sendParticles(
                    new BlockParticleOption(ParticleTypes.BLOCK, state),
                    center.x, center.y, center.z,
                    36,
                    0.55, 0.16, 0.55,
                    0.12
            );
        }

        level.playSound(
                null,
                center.x, center.y, center.z,
                SoundEvents.GENERIC_EXPLODE,
                SoundSource.PLAYERS,
                0.55f,
                1.55f
        );
    }

    private static void finishDash(ServerPlayer player, boolean impactEffect) {
        if (impactEffect) spawnFrontDashImpact(player);

        player.getPersistentData().putInt("jn_dash_mode", DASH_NONE);
        player.getPersistentData().remove("jn_dash_started");
        player.getPersistentData().remove("jn_dash_dx");
        player.getPersistentData().remove("jn_dash_dy");
        player.getPersistentData().remove("jn_dash_dz");
        player.getPersistentData().remove("jn_dash_hit");
        player.setDeltaMovement(Vec3.ZERO);
        player.hurtMarked = true;
    }

    private static void tickDashState(ServerPlayer player, ServerLevel level, long now) {
        int mode = player.getPersistentData().getInt("jn_dash_mode");
        if (mode == DASH_NONE) return;

        if (!player.isAlive() || !hasGojoBlindfold(player)) {
            finishDash(player, false);
            return;
        }

        long start = player.getPersistentData().getLong("jn_dash_started");
        long elapsed = now - start;

        Vec3 dir = new Vec3(
                player.getPersistentData().getDouble("jn_dash_dx"),
                player.getPersistentData().getDouble("jn_dash_dy"),
                player.getPersistentData().getDouble("jn_dash_dz")
        );
        if (dir.lengthSqr() < 1.0E-5) {
            finishDash(player, false);
            return;
        }
        dir = dir.normalize();

        if (mode == DASH_FRONT) {
            if (elapsed >= FRONT_DASH_TICKS) {
                finishDash(player, !player.getPersistentData().getBoolean("jn_dash_hit"));
                return;
            }

            double t = elapsed / (double) FRONT_DASH_TICKS;
            double speed = 1.32 - 1.02 * t; // длинный старт, заметное замедление к концу
            Vec3 step = dir.scale(speed);

            Vec3 before = player.position();
            LivingEntity victim = findDashVictim(player, before, before.add(step));

            if (victim != null) {
                victim.hurt(level.damageSources().playerAttack(player), FRONT_DASH_DAMAGE);
                Vec3 knock = dir.scale(1.35).add(0.0, 0.22, 0.0);
                victim.setDeltaMovement(victim.getDeltaMovement().add(knock));
                victim.hurtMarked = true;
                player.getPersistentData().putBoolean("jn_dash_hit", true);

                Vec3 hitPos = victim.position().add(0.0, victim.getBbHeight() * 0.5, 0.0);
                spawnRadialStar(
                        level,
                        hitPos,
                        new Vector3f(0.65f, 0.90f, 1.0f),
                        new Vector3f(0.12f, 0.60f, 1.0f),
                        10,
                        2.2
                );
                finishDash(player, false);
                return;
            }

            if (!tryDashMove(player, step, true)) {
                // Стена выше 2 блоков: без урона владельцу и без застревания.
                finishDash(player, true);
                return;
            }

            if (now % 2 == 0) {
                spawnVfx(level, VFX_TRAIL, player.position().add(0, 0.9, 0), 1);
            }
            return;
        }

        if (mode == DASH_SIDE) {
            if (elapsed >= SIDE_DASH_TICKS) {
                finishDash(player, false);
                return;
            }

            Vec3 step = dir.scale(1.28);
            if (!tryDashMove(player, step, true)) {
                finishDash(player, false);
                return;
            }

            spawnVfx(level, VFX_TRAIL, player.position().add(0, 0.85, 0), 1);
            return;
        }

        if (mode == DASH_AIR) {
            if (elapsed >= AIR_DASH_TICKS) {
                finishDash(player, false);
                return;
            }

            // ~5 блоков за один короткий воздушный рывок.
            Vec3 step = dir.scale(1.68);
            if (!tryDashMove(player, step, false)) {
                finishDash(player, false);
                return;
            }

            player.fallDistance = 0.0F;
            spawnVfx(level, VFX_TRAIL, player.position().add(0, 0.85, 0), 1);
        }
    }

    private static void performChargedJump(ServerPlayer player, int tier) {
        if (player == null || !player.isAlive() || player.isSpectator()) return;
        if (!hasGojoBlindfold(player)) {
            requireBlindfoldMessage(player);
            return;
        }
        if (!player.onGround()) return;

        int clamped = Mth.clamp(tier, 0, 3);
        double yVelocity = switch (clamped) {
            case 1 -> 1.099; // ~7 блоков
            case 2 -> 1.560; // ~13 блоков
            case 3 -> 1.880; // ~18 блоков
            default -> 0.545; // ~2 блока
        };

        player.setDeltaMovement(
                player.getDeltaMovement().x,
                yVelocity,
                player.getDeltaMovement().z
        );
        player.hurtMarked = true;
        player.fallDistance = 0.0F;

        ServerLevel level = player.serverLevel();
        spawnNeonRing(
                level,
                player.position().add(0.0, 0.08, 0.0),
                clamped == 0 ? 0.65 : 0.90 + clamped * 0.25,
                new Vector3f(0.10f, 0.78f, 1.0f)
        );
        level.playSound(
                null,
                player.blockPosition(),
                SoundEvents.PLAYER_ATTACK_SWEEP,
                SoundSource.PLAYERS,
                0.45f,
                1.25f - clamped * 0.08f
        );
    }

    private static void executeLongRangeTeleport(ServerPlayer player, BlockPos targetBlock, Direction face) {
        if (player == null || !player.isAlive() || player.isSpectator()) return;
        if (!hasGojoBlindfold(player)) {
            requireBlindfoldMessage(player);
            return;
        }

        ServerLevel level = player.serverLevel();
        long now = level.getGameTime();
        long cooldown = player.getPersistentData().getLong("jn_r_tp_cd");

        if (now < cooldown) {
            long ticksLeft = cooldown - now;
            double seconds = Math.ceil(ticksLeft / 2.0) / 10.0;
            player.displayClientMessage(
                    Component.literal("Телепорт: " + seconds + " сек.")
                            .withStyle(ChatFormatting.GRAY),
                    true
            );
            return;
        }

        if (!level.hasChunkAt(targetBlock)) return;

        BlockPos initial = targetBlock.relative(face);
        BlockPos safe = findSafeTeleportPosition(level, initial);
        if (safe == null) return;

        Vec3 oldPos = player.position();
        Vec3 destination = new Vec3(
                safe.getX() + 0.5,
                safe.getY(),
                safe.getZ() + 0.5
        );

        spawnTeleportBurst(level, oldPos.add(0.0, 0.9, 0.0));
        player.teleportTo(destination.x, destination.y, destination.z);
        player.setDeltaMovement(Vec3.ZERO);
        player.fallDistance = 0.0F;
        player.hurtMarked = true;
        player.getPersistentData().putLong("jn_r_tp_cd", now + 80); // 4 секунды
        spawnTeleportBurst(level, destination.add(0.0, 0.9, 0.0));

        level.playSound(
                null,
                destination.x, destination.y, destination.z,
                SoundEvents.ENDERMAN_TELEPORT,
                SoundSource.PLAYERS,
                1.0f,
                1.05f
        );

        // Зона стана 4x4 вокруг точки приземления, владелец иммунен.
        AABB stunZone = new AABB(
                destination.x - 2.0, destination.y - 2.0, destination.z - 2.0,
                destination.x + 2.0, destination.y + 2.0, destination.z + 2.0
        );

        List<LivingEntity> targets = level.getEntitiesOfClass(
                LivingEntity.class,
                stunZone,
                e -> e.isAlive() && e != player && !e.isSpectator()
        );

        for (LivingEntity target : targets) {
            applyTeleportStun(target, now + 40); // 2 секунды
        }
    }

    private static BlockPos findSafeTeleportPosition(ServerLevel level, BlockPos preferred) {
        // Сначала точная клетка рядом с гранью попадания, затем небольшой безопасный поиск.
        int[][] offsets = {
                {0,0,0},
                {0,1,0},
                {1,0,0},{-1,0,0},{0,0,1},{0,0,-1},
                {1,1,0},{-1,1,0},{0,1,1},{0,1,-1},
                {1,0,1},{1,0,-1},{-1,0,1},{-1,0,-1}
        };

        for (int[] o : offsets) {
            BlockPos feet = preferred.offset(o[0], o[1], o[2]);
            BlockPos head = feet.above();

            if (!level.hasChunkAt(feet) || !level.hasChunkAt(head)) continue;

            boolean feetPassable = level.getBlockState(feet).getCollisionShape(level, feet).isEmpty();
            boolean headPassable = level.getBlockState(head).getCollisionShape(level, head).isEmpty();

            if (feetPassable && headPassable) return feet;
        }

        return null;
    }

    private static void spawnTeleportBurst(ServerLevel level, Vec3 center) {
        for (int ring = 0; ring < 3; ring++) {
            double radius = 0.75 + ring * 0.48;
            int points = 30 + ring * 10;

            for (int i = 0; i < points; i++) {
                double a = Math.PI * 2.0 * i / points;
                Vec3 p = center.add(
                        Math.cos(a) * radius,
                        Math.sin(a * 2.0) * 0.15,
                        Math.sin(a) * radius
                );
                sendDust(
                        level,
                        p,
                        ring == 1
                                ? new Vector3f(0.52f, 0.08f, 1.0f)
                                : new Vector3f(0.08f, 0.78f, 1.0f),
                        0.72f
                );
            }
        }

        spawnVfx(level, VFX_TELEPORT, center, 1);
    }

    private static void applyTeleportStun(LivingEntity target, long until) {
        target.getPersistentData().putLong("jn_stun_until", until);
        target.getPersistentData().putDouble("jn_stun_x", target.getX());
        target.getPersistentData().putDouble("jn_stun_y", target.getY());
        target.getPersistentData().putDouble("jn_stun_z", target.getZ());
        target.setDeltaMovement(Vec3.ZERO);
        target.hurtMarked = true;
    }

    private static final int NORMAL_WALK_SPEED_AMPLIFIER = 9;  // 3x vanilla walk
    private static final int SUPER_RUN_SPEED_AMPLIFIER = 34;   // 8x vanilla walk
    private static final long SUPER_RUN_COST_INTERVAL = 40L;   // 2 секунды
    private static final double SUPER_RUN_COST = 1.0;           // 1% CE

    private static Vec3 runInputDirection(ServerPlayer player) {
        float forwardInput = player.zza;
        float strafeInput = player.xxa;

        if (Math.abs(forwardInput) < 0.01F && Math.abs(strafeInput) < 0.01F) {
            Vec3 velocity = player.getDeltaMovement();
            Vec3 horizontal = new Vec3(velocity.x, 0.0, velocity.z);
            return horizontal.lengthSqr() > 1.0E-4 ? horizontal.normalize() : Vec3.ZERO;
        }

        double yaw = Math.toRadians(player.getYRot());
        Vec3 forward = new Vec3(-Math.sin(yaw), 0.0, Math.cos(yaw));
        Vec3 right = new Vec3(forward.z, 0.0, -forward.x);

        Vec3 dir = forward.scale(forwardInput).add(right.scale(strafeInput));
        return dir.lengthSqr() > 1.0E-4 ? dir.normalize() : Vec3.ZERO;
    }

    private static void trySuperRunStepUp(ServerPlayer player) {
        if (!player.horizontalCollision) return;

        Vec3 dir = runInputDirection(player);
        if (dir.lengthSqr() < 1.0E-4) return;

        ServerLevel level = player.serverLevel();
        AABB box = player.getBoundingBox();

        // Перепады в 1-2 блока автоматически преодолеваются.
        for (int h = 1; h <= 2; h++) {
            Vec3 step = new Vec3(dir.x * 0.58, h, dir.z * 0.58);
            if (level.noCollision(player, box.move(step))) {
                player.move(MoverType.SELF, step);
                player.setDeltaMovement(
                        player.getDeltaMovement().x,
                        Math.max(0.0, player.getDeltaMovement().y),
                        player.getDeltaMovement().z
                );
                player.hurtMarked = true;
                return;
            }
        }
        // Стена 3+ блока просто останавливает движение; режим сверхбега остаётся включён.
    }

    private static boolean isNaturalTreeLog(ServerLevel level, BlockPos start) {
        BlockState startState = level.getBlockState(start);
        if (!startState.is(BlockTags.LOGS)) return false;

        List<BlockPos> queue = new ArrayList<>();
        List<BlockPos> visited = new ArrayList<>();
        queue.add(start.immutable());

        boolean grounded = false;
        int leavesNearby = 0;
        int minY = start.getY();
        int maxY = start.getY();

        for (int qi = 0; qi < queue.size() && visited.size() < 40; qi++) {
            BlockPos pos = queue.get(qi);
            if (visited.contains(pos)) continue;

            BlockState state = level.getBlockState(pos);
            if (!state.is(BlockTags.LOGS)) continue;

            visited.add(pos);
            minY = Math.min(minY, pos.getY());
            maxY = Math.max(maxY, pos.getY());

            BlockState below = level.getBlockState(pos.below());
            if (below.is(Blocks.DIRT) ||
                    below.is(Blocks.GRASS_BLOCK) ||
                    below.is(Blocks.PODZOL) ||
                    below.is(Blocks.COARSE_DIRT) ||
                    below.is(Blocks.ROOTED_DIRT) ||
                    below.is(Blocks.MUD) ||
                    below.is(Blocks.MYCELIUM)) {
                grounded = true;
            }

            for (int dx = -2; dx <= 2; dx++) {
                for (int dy = -2; dy <= 3; dy++) {
                    for (int dz = -2; dz <= 2; dz++) {
                        if (Math.abs(dx) + Math.abs(dz) > 3) continue;
                        if (level.getBlockState(pos.offset(dx, dy, dz)).is(BlockTags.LEAVES)) {
                            leavesNearby++;
                            if (leavesNearby >= 4) break;
                        }
                    }
                    if (leavesNearby >= 4) break;
                }
                if (leavesNearby >= 4) break;
            }

            for (Direction direction : Direction.values()) {
                BlockPos next = pos.relative(direction);
                if (!visited.contains(next) && level.getBlockState(next).is(BlockTags.LOGS)) {
                    queue.add(next.immutable());
                }
            }
        }

        // Дом из брёвен обычно не имеет одновременно настоящей кроны,
        // связи с грунтом и вертикального ствола.
        return grounded && leavesNearby >= 4 && (maxY - minY >= 2);
    }

    private static boolean isSuperRunPlant(ServerLevel level, BlockPos pos, BlockState state) {
        if (state.isAir()) return false;

        if (state.is(BlockTags.LEAVES) ||
                state.is(BlockTags.FLOWERS) ||
                state.is(BlockTags.SAPLINGS)) {
            return true;
        }

        if (state.is(BlockTags.LOGS)) {
            return isNaturalTreeLog(level, pos);
        }

        return state.is(Blocks.GRASS) ||
                state.is(Blocks.TALL_GRASS) ||
                state.is(Blocks.FERN) ||
                state.is(Blocks.LARGE_FERN) ||
                state.is(Blocks.VINE) ||
                state.is(Blocks.DEAD_BUSH) ||
                state.is(Blocks.SWEET_BERRY_BUSH) ||
                state.is(Blocks.AZALEA) ||
                state.is(Blocks.FLOWERING_AZALEA) ||
                state.is(Blocks.BAMBOO) ||
                state.is(Blocks.SUGAR_CANE);
    }

    private static void vaporizeSuperRunPlants(ServerPlayer player, ServerLevel level) {
        Vec3 current = player.position();

        boolean hasLast = player.getPersistentData().contains("jn_speed_last_x") &&
                player.getPersistentData().contains("jn_speed_last_y") &&
                player.getPersistentData().contains("jn_speed_last_z");

        if (!hasLast) {
            player.getPersistentData().putDouble("jn_speed_last_x", current.x);
            player.getPersistentData().putDouble("jn_speed_last_y", current.y);
            player.getPersistentData().putDouble("jn_speed_last_z", current.z);
            return;
        }

        Vec3 previous = new Vec3(
                player.getPersistentData().getDouble("jn_speed_last_x"),
                player.getPersistentData().getDouble("jn_speed_last_y"),
                player.getPersistentData().getDouble("jn_speed_last_z")
        );

        player.getPersistentData().putDouble("jn_speed_last_x", current.x);
        player.getPersistentData().putDouble("jn_speed_last_y", current.y);
        player.getPersistentData().putDouble("jn_speed_last_z", current.z);

        // Не сносим мир после телепорта или иных резких перемещений.
        if (previous.distanceToSqr(current) > 16.0) return;

        double minX = Math.min(previous.x, current.x) - 0.55;
        double maxX = Math.max(previous.x, current.x) + 0.55;
        double minY = Math.min(previous.y, current.y);
        double maxY = Math.max(previous.y, current.y) + player.getBbHeight() + 0.15;
        double minZ = Math.min(previous.z, current.z) - 0.55;
        double maxZ = Math.max(previous.z, current.z) + 0.55;

        List<BlockPos> toRemove = new ArrayList<>();

        for (int x = Mth.floor(minX); x <= Mth.floor(maxX); x++) {
            for (int y = Mth.floor(minY); y <= Mth.floor(maxY); y++) {
                for (int z = Mth.floor(minZ); z <= Mth.floor(maxZ); z++) {
                    BlockPos pos = new BlockPos(x, y, z);
                    BlockState state = level.getBlockState(pos);
                    if (isSuperRunPlant(level, pos, state)) {
                        toRemove.add(pos.immutable());
                    }
                }
            }
        }

        for (BlockPos pos : toRemove) {
            BlockState state = level.getBlockState(pos);
            if (state.isAir()) continue;

            // Полное испарение без drop/item entities.
            level.setBlock(pos, Blocks.AIR.defaultBlockState(), 3);

            level.sendParticles(
                    new BlockParticleOption(ParticleTypes.BLOCK, state),
                    pos.getX() + 0.5,
                    pos.getY() + 0.5,
                    pos.getZ() + 0.5,
                    7,
                    0.32, 0.32, 0.32,
                    0.08
            );
        }
    }

    private static void supportSuperRunOnWater(ServerPlayer player, ServerLevel level) {
        BlockPos below = BlockPos.containing(
                player.getX(),
                player.getY() - 0.18,
                player.getZ()
        );

        var fluid = level.getFluidState(below);
        if (!fluid.is(FluidTags.WATER)) return;

        double surfaceY = below.getY() + fluid.getHeight(level, below);

        // Работает именно как бег по поверхности, а не как полёт из глубины воды.
        if (player.getY() < surfaceY - 0.42 || player.getY() > surfaceY + 0.50) return;

        player.setPos(player.getX(), surfaceY + 0.03, player.getZ());
        player.setDeltaMovement(
                player.getDeltaMovement().x,
                0.015,
                player.getDeltaMovement().z
        );
        player.fallDistance = 0.0F;
        player.hurtMarked = true;

        if (level.getGameTime() % 2 == 0) {
            level.sendParticles(
                    ParticleTypes.SPLASH,
                    player.getX(),
                    surfaceY + 0.07,
                    player.getZ(),
                    10,
                    0.55, 0.04, 0.55,
                    0.20
            );

            spawnNeonRing(
                    level,
                    new Vec3(player.getX(), surfaceY + 0.04, player.getZ()),
                    0.75,
                    new Vector3f(0.08f, 0.72f, 1.0f)
            );
        }
    }

    private static void spawnSuperRunEffects(ServerPlayer player, ServerLevel level, long now) {
        if (now % 2 == 0) {
            Vec3 base = player.position().add(0.0, 0.85, 0.0);

            for (int i = 0; i < 5; i++) {
                Vec3 trail = base.add(
                        rnd(-0.42, 0.42),
                        rnd(-0.70, 0.75),
                        rnd(-0.42, 0.42)
                );
                sendDust(
                        level,
                        trail,
                        i % 2 == 0
                                ? new Vector3f(0.72f, 0.94f, 1.0f)
                                : new Vector3f(0.06f, 0.68f, 1.0f),
                        0.48f
                );
            }

            spawnVfx(level, VFX_TRAIL, base, 1);
        }

        if (now % 4 == 0) {
            BlockPos ground = BlockPos.containing(
                    player.getX(),
                    player.getY() - 0.10,
                    player.getZ()
            );
            BlockState state = level.getBlockState(ground);
            if (!state.isAir() && state.getFluidState().isEmpty()) {
                level.sendParticles(
                        new BlockParticleOption(ParticleTypes.BLOCK, state),
                        player.getX(),
                        player.getY() + 0.05,
                        player.getZ(),
                        7,
                        0.38, 0.05, 0.38,
                        0.07
                );
            }
        }

        if (now % 30 == 0) {
            playSfx(level, player, SFX_DASH, 0.34f, 1.45f);
        }
    }

    private static void tickBlindfoldRun(ServerPlayer player, ServerLevel level, long now) {
        boolean speed = player.getPersistentData().getBoolean("jn_super_speed");

        // Без CTRL: ровно усиленная ходьба около 3x. Ванильный sprint не суммируется.
        player.setSprinting(false);

        if (!speed) {
            player.addEffect(new MobEffectInstance(
                    MobEffects.MOVEMENT_SPEED,
                    6,
                    NORMAL_WALK_SPEED_AMPLIFIER,
                    false, false, false
            ));
            player.getPersistentData().remove("jn_speed_last_x");
            player.getPersistentData().remove("jn_speed_last_y");
            player.getPersistentData().remove("jn_speed_last_z");
            return;
        }

        // CTRL: отдельный режим сверхбега ~8x.
        long nextCost = player.getPersistentData().getLong("jn_speed_next_cost");
        if (nextCost <= 0) {
            nextCost = now + SUPER_RUN_COST_INTERVAL;
            player.getPersistentData().putLong("jn_speed_next_cost", nextCost);
        }

        if (now >= nextCost) {
            if (getEnergy(player) + 1.0E-6 < SUPER_RUN_COST) {
                player.getPersistentData().putBoolean("jn_super_speed", false);
                player.getPersistentData().remove("jn_speed_next_cost");
                return;
            }

            setEnergy(player, getEnergy(player) - SUPER_RUN_COST);
            player.getPersistentData().putLong("jn_speed_next_cost", now + SUPER_RUN_COST_INTERVAL);
        }

        player.addEffect(new MobEffectInstance(
                MobEffects.MOVEMENT_SPEED,
                6,
                SUPER_RUN_SPEED_AMPLIFIER,
                false, false, false
        ));

        trySuperRunStepUp(player);
        supportSuperRunOnWater(player, level);
        vaporizeSuperRunPlants(player, level);
        spawnSuperRunEffects(player, level, now);
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
            if (event.getSource().getEntity() instanceof LivingEntity stunnedAttacker &&
                    stunnedAttacker.getPersistentData().getLong("jn_stun_until") > stunnedAttacker.level().getGameTime()) {
                event.setCanceled(true);
                return;
            }

            if (event.getSource().getEntity() instanceof ServerPlayer redOwner &&
                    redOwner.getPersistentData().getBoolean("jn_red_explosion_blocks_only")) {
                event.setCanceled(true);
                return;
            }

            if (event.getSource().getEntity() instanceof ServerPlayer attacker &&
                    isBlueInteractionActive(attacker) &&
                    !attacker.getPersistentData().getBoolean("jn_blue_custom_damage") &&
                    !attacker.getPersistentData().getBoolean("jn_red_custom_damage")) {
                event.setCanceled(true);
                return;
            }
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
        public static void onBlindfoldFall(LivingFallEvent event) {
            if (event.getEntity() instanceof ServerPlayer player && hasGojoBlindfold(player)) {
                event.setCanceled(true);
                player.fallDistance = 0.0F;
            }
        }

        @SubscribeEvent
        public static void onLivingTick(LivingEvent.LivingTickEvent event) {
            LivingEntity entity = event.getEntity();
            if (entity.level().isClientSide()) return;

            long until = entity.getPersistentData().getLong("jn_stun_until");
            if (until <= 0) return;

            long now = entity.level().getGameTime();
            if (now >= until) {
                entity.getPersistentData().remove("jn_stun_until");
                entity.getPersistentData().remove("jn_stun_x");
                entity.getPersistentData().remove("jn_stun_y");
                entity.getPersistentData().remove("jn_stun_z");
                return;
            }

            double x = entity.getPersistentData().getDouble("jn_stun_x");
            double y = entity.getPersistentData().getDouble("jn_stun_y");
            double z = entity.getPersistentData().getDouble("jn_stun_z");

            entity.teleportTo(x, y, z);
            entity.setDeltaMovement(Vec3.ZERO);
            entity.setSprinting(false);
            entity.fallDistance = 0.0F;
            entity.hurtMarked = true;
        }

        @SubscribeEvent
        public static void onPlayerTick(TickEvent.PlayerTickEvent event) {
            if (event.phase != TickEvent.Phase.END) return;
            if (!(event.player instanceof ServerPlayer player)) return;

            ServerLevel level = player.serverLevel();
            long now = level.getGameTime();
            boolean equipped = hasGojoBlindfold(player);

            tickBlueState(player, level, now);
            tickRedState(player, level, now);
            tickMaximumBlueState(player, level, now);
            tickDashState(player, level, now);

            if (!equipped) {
                player.getPersistentData().putBoolean("jn_super_speed", false);
                player.getPersistentData().remove("jn_speed_next_cost");
                player.getPersistentData().remove("jn_speed_last_x");
                player.getPersistentData().remove("jn_speed_last_y");
                player.getPersistentData().remove("jn_speed_last_z");
                player.getPersistentData().putBoolean("jn_infinity", false);
                player.getPersistentData().putInt("jn_air_jumps", 0);
            } else {
                if (player.onGround()) {
                    player.getPersistentData().putInt("jn_air_jumps", 0);
                }

                boolean speed = player.getPersistentData().getBoolean("jn_super_speed");
                boolean infinity = player.getPersistentData().getBoolean("jn_infinity");
                boolean domain = player.getPersistentData().getLong("jn_domain_until") > now;

                // В режиме сверхбега энергия не регенерирует: расход строго 1% за 2 секунды.
                double regen = speed ? 0.0 : 0.28;
                if (infinity || domain) regen *= 0.45;
                setEnergy(player, getEnergy(player) + regen);

                tickBlindfoldRun(player, level, now);

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
                NETWORK.send(
                        PacketDistributor.PLAYER.with(() -> player),
                        new HudSyncPacket(
                                getEnergy(player),
                                player.getPersistentData().getInt("jn_air_jumps"),
                                player.getPersistentData().getBoolean("jn_infinity"),
                                equipped,
                                isBlueInteractionActive(player),
                                isMaximumBlueActive(player)
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

    private record BlueActionPacket() {

        static void encode(BlueActionPacket msg, FriendlyByteBuf buf) {
        }

        static BlueActionPacket decode(FriendlyByteBuf buf) {
            return new BlueActionPacket();
        }

        static void handle(BlueActionPacket msg, Supplier<NetworkEvent.Context> contextSupplier) {
            NetworkEvent.Context context = contextSupplier.get();
            context.enqueueWork(() -> {
                ServerPlayer player = context.getSender();
                if (player != null) bluePrimaryAction(player);
            });
            context.setPacketHandled(true);
        }
    }

    private record RedControlPacket(RedControlAction action) {

        static void encode(RedControlPacket msg, FriendlyByteBuf buf) {
            buf.writeEnum(msg.action);
        }

        static RedControlPacket decode(FriendlyByteBuf buf) {
            return new RedControlPacket(buf.readEnum(RedControlAction.class));
        }

        static void handle(RedControlPacket msg, Supplier<NetworkEvent.Context> contextSupplier) {
            NetworkEvent.Context context = contextSupplier.get();

            context.enqueueWork(() -> {
                ServerPlayer player = context.getSender();
                if (player == null) return;

                switch (msg.action) {
                    case START -> startRedCharge(player);
                    case RELEASE -> releaseRedCharge(player);
                    case CANCEL -> cancelRedCharge(player, true);
                }
            });

            context.setPacketHandled(true);
        }
    }

    private record MaxBlueControlPacket(MaxBlueControlAction action) {
        static void encode(MaxBlueControlPacket msg, FriendlyByteBuf buf) {
            buf.writeEnum(msg.action);
        }

        static MaxBlueControlPacket decode(FriendlyByteBuf buf) {
            return new MaxBlueControlPacket(buf.readEnum(MaxBlueControlAction.class));
        }

        static void handle(MaxBlueControlPacket msg, Supplier<NetworkEvent.Context> contextSupplier) {
            NetworkEvent.Context context = contextSupplier.get();
            context.enqueueWork(() -> {
                ServerPlayer player = context.getSender();
                if (player == null) return;

                switch (msg.action) {
                    case START -> startMaximumBlue(player);
                    case RELEASE -> beginMaximumBlueFade(player);
                    case FARTHER -> adjustMaximumBlueDistance(player, 0.35);
                    case CLOSER -> adjustMaximumBlueDistance(player, -0.35);
                }
            });
            context.setPacketHandled(true);
        }
    }

    private record JumpControlPacket(int tier) {
        static void encode(JumpControlPacket msg, FriendlyByteBuf buf) {
            buf.writeByte(msg.tier);
        }

        static JumpControlPacket decode(FriendlyByteBuf buf) {
            return new JumpControlPacket(buf.readByte());
        }

        static void handle(JumpControlPacket msg, Supplier<NetworkEvent.Context> contextSupplier) {
            NetworkEvent.Context context = contextSupplier.get();
            context.enqueueWork(() -> {
                ServerPlayer player = context.getSender();
                if (player != null) performChargedJump(player, msg.tier);
            });
            context.setPacketHandled(true);
        }
    }

    private record TeleportPacket(BlockPos target, Direction face) {
        static void encode(TeleportPacket msg, FriendlyByteBuf buf) {
            buf.writeBlockPos(msg.target);
            buf.writeEnum(msg.face);
        }

        static TeleportPacket decode(FriendlyByteBuf buf) {
            return new TeleportPacket(buf.readBlockPos(), buf.readEnum(Direction.class));
        }

        static void handle(TeleportPacket msg, Supplier<NetworkEvent.Context> contextSupplier) {
            NetworkEvent.Context context = contextSupplier.get();
            context.enqueueWork(() -> {
                ServerPlayer player = context.getSender();
                if (player != null) executeLongRangeTeleport(player, msg.target, msg.face);
            });
            context.setPacketHandled(true);
        }
    }

    private record HudSyncPacket(double energy, int airJumps, boolean infinity, boolean blindfold, boolean blueActive, boolean maxBlueActive) {

        static void encode(HudSyncPacket msg, FriendlyByteBuf buf) {
            buf.writeDouble(msg.energy);
            buf.writeVarInt(msg.airJumps);
            buf.writeBoolean(msg.infinity);
            buf.writeBoolean(msg.blindfold);
            buf.writeBoolean(msg.blueActive);
            buf.writeBoolean(msg.maxBlueActive);
        }

        static HudSyncPacket decode(FriendlyByteBuf buf) {
            return new HudSyncPacket(
                    buf.readDouble(),
                    buf.readVarInt(),
                    buf.readBoolean(),
                    buf.readBoolean(),
                    buf.readBoolean(),
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
                "Сверхбег 8x",
                InputConstants.Type.KEYSYM,
                GLFW.GLFW_KEY_LEFT_CONTROL,
                CATEGORY
        );

        public static final KeyMapping BLUE_KEY = new KeyMapping(
                "Z: Blue / удержание: Maximum Blue (W/S дистанция)",
                InputConstants.Type.KEYSYM,
                GLFW.GLFW_KEY_Z,
                CATEGORY
        );

        public static final KeyMapping RED_KEY = new KeyMapping(
                "X: Red / 2с: Maximum Red / авто-выстрел 5с",
                InputConstants.Type.KEYSYM,
                GLFW.GLFW_KEY_X,
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

        public static final KeyMapping TELEPORT_KEY = new KeyMapping(
                "R: Мгновенный телепорт к блоку",
                InputConstants.Type.KEYSYM,
                GLFW.GLFW_KEY_R,
                CATEGORY
        );

        @SubscribeEvent
        public static void registerParticles(RegisterParticleProvidersEvent event) {
            event.registerSpriteSet(VFX_BLUE.get(), sprites -> new UltraVfxProvider(sprites, 3.8f, 18, 0.015f));
            event.registerSpriteSet(VFX_MAX_BLUE.get(), sprites -> new UltraVfxProvider(sprites, 6.5f, 30, 0.020f));
            event.registerSpriteSet(VFX_RED.get(), sprites -> new UltraVfxProvider(sprites, 5.2f, 18, 0.035f));
            event.registerSpriteSet(VFX_PURPLE.get(), sprites -> new UltraVfxProvider(sprites, 7.5f, 32, 0.018f));
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
            event.register(DOMAIN_KEY);
            event.register(UTILITY_KEY);
            event.register(HUD_KEY);
            event.register(TELEPORT_KEY);
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
        private static boolean jumpChargeWasDown = false;
        private static int jumpChargeTicks = 0;

        private static final HoldKeyState BLUE_STATE = new HoldKeyState();
        private static final HoldKeyState RED_STATE = new HoldKeyState();
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
        private static boolean hudBlindfold = false;
        private static boolean hudBlueActive = false;
        private static boolean hudMaxBlueActive = false;

        private static void applyHudSync(HudSyncPacket msg) {
            hudEnergy = msg.energy();
            hudAirJumps = msg.airJumps();
            hudInfinity = msg.infinity();
            hudBlindfold = msg.blindfold();
            hudBlueActive = msg.blueActive();
            hudMaxBlueActive = msg.maxBlueActive();
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

        private static void processRedKey(KeyMapping key, HoldKeyState state) {
            boolean down = key.isDown();

            if (down) {
                if (!state.wasDown) {
                    state.ticks = 0;
                    state.holdTriggered = false;
                    NETWORK.sendToServer(new RedControlPacket(RedControlAction.START));
                    startAnim("RED", 10);
                }

                state.ticks++;

                // До 2 секунд это обычный Red. После 2 секунд он превращается в Maximum Red.
                if (state.ticks >= 40 && state.ticks < 100) {
                    chargingAnim = "CHARGE_MAX_RED";
                    chargingProgress = Mth.clamp((state.ticks - 40) / 60.0f, 0.0f, 1.0f);

                    if (!state.holdTriggered) {
                        state.holdTriggered = true;
                        startAnim("MAX_RED", 18);
                    }
                } else if (state.ticks >= 100) {
                    // Сервер сам выстрелит ровно на 5-й секунде.
                    chargingAnim = "NONE";
                    chargingProgress = 0.0f;

                    if (state.ticks == 100) {
                        startAnim("MAX_RED", 20);
                    }
                } else {
                    chargingAnim = "NONE";
                    chargingProgress = 0.0f;
                }
            } else if (state.wasDown) {
                chargingAnim = "NONE";
                chargingProgress = 0.0f;

                // Сервер по фактическому времени удержания сам выберет обычный или Maximum Red.
                NETWORK.sendToServer(new RedControlPacket(RedControlAction.RELEASE));
                startAnim(state.ticks >= 40 ? "MAX_RED" : "RED", state.ticks >= 40 ? 20 : 12);

                state.ticks = 0;
                state.holdTriggered = false;
            }

            state.wasDown = down;
        }

        private static void processBlueKey(KeyMapping key, HoldKeyState state) {
            boolean down = key.isDown();

            if (down) {
                if (!state.wasDown) {
                    state.ticks = 0;
                    state.holdTriggered = false;
                }

                state.ticks++;

                if (!state.holdTriggered) {
                    chargingAnim = "CHARGE_BLUE";
                    chargingProgress = Mth.clamp(state.ticks / (float) HOLD_TICKS, 0.0f, 1.0f);
                }

                if (!state.holdTriggered && state.ticks >= HOLD_TICKS) {
                    state.holdTriggered = true;
                    chargingAnim = "NONE";
                    chargingProgress = 0.0f;
                    NETWORK.sendToServer(new MaxBlueControlPacket(MaxBlueControlAction.START));
                    startAnim("MAX_BLUE", 60);
                }
            } else if (state.wasDown) {
                chargingAnim = "NONE";
                chargingProgress = 0.0f;

                if (state.holdTriggered) {
                    NETWORK.sendToServer(new MaxBlueControlPacket(MaxBlueControlAction.RELEASE));
                } else {
                    NETWORK.sendToServer(new AbilityPacket(Ability.BLUE));
                    startAnim("BLUE", 12);
                }

                state.ticks = 0;
                state.holdTriggered = false;
            }

            state.wasDown = down;
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
        public static void onBlueAttackClick(InputEvent.InteractionKeyMappingTriggered event) {
            if (!hudBlueActive || !event.isAttack()) return;

            event.setCanceled(true);
            event.setSwingHand(true);
            NETWORK.sendToServer(new BlueActionPacket());
        }

        @SubscribeEvent
        public static void onClientTick(TickEvent.ClientTickEvent event) {
            Minecraft mc = Minecraft.getInstance();
            if (mc.player == null) return;

            if (event.phase == TickEvent.Phase.START) {
                if (hudBlindfold && mc.screen == null) {
                    // Подавляем ванильный прыжок: с повязкой прыжками управляет наша зарядка.
                    mc.player.input.jumping = false;
                }
                return;
            }

            if (event.phase != TickEvent.Phase.END) return;

            if (activeAnimTicks > 0) activeAnimTicks--;

            if (mc.screen != null) {
                if (lastSpeedHeld) {
                    NETWORK.sendToServer(new MovementPacket(MovementAction.SPEED_OFF));
                    lastSpeedHeld = false;
                }
                jumpChargeWasDown = false;
                jumpChargeTicks = 0;
                chargingAnim = "NONE";
                return;
            }

            while (ClientModEvents.HUD_KEY.consumeClick()) {
                hudVisible = !hudVisible;
            }

            while (ClientModEvents.TELEPORT_KEY.consumeClick()) {
                if (hudBlindfold && mc.level != null) {
                    double maxDistance = Math.max(16.0, mc.options.renderDistance().get() * 16.0);
                    Vec3 start = mc.player.getEyePosition();
                    Vec3 end = start.add(mc.player.getLookAngle().normalize().scale(maxDistance));

                    BlockHitResult hit = mc.level.clip(new ClipContext(
                            start,
                            end,
                            ClipContext.Block.COLLIDER,
                            ClipContext.Fluid.ANY,
                            mc.player
                    ));

                    if (hit.getType() != HitResult.Type.MISS) {
                        NETWORK.sendToServer(new TeleportPacket(hit.getBlockPos(), hit.getDirection()));
                        startAnim("TELEPORT", 8);
                    }
                }
            }

            boolean jumpHeldNow = mc.options.keyJump.isDown();
            if (hudBlindfold) {
                mc.player.input.jumping = false;

                if (jumpHeldNow) {
                    if (!jumpChargeWasDown) jumpChargeTicks = 0;
                    jumpChargeTicks = Math.min(60, jumpChargeTicks + 1);
                } else if (jumpChargeWasDown) {
                    int tier;
                    if (jumpChargeTicks >= 60) tier = 3;
                    else if (jumpChargeTicks >= 40) tier = 2;
                    else if (jumpChargeTicks >= 20) tier = 1;
                    else tier = 0;

                    NETWORK.sendToServer(new JumpControlPacket(tier));
                    jumpChargeTicks = 0;
                }

                jumpChargeWasDown = jumpHeldNow;
            } else {
                jumpChargeWasDown = false;
                jumpChargeTicks = 0;
            }

            while (ClientModEvents.DASH_KEY.consumeClick()) {
                boolean left = mc.options.keyLeft.isDown() && !mc.options.keyRight.isDown();
                boolean right = mc.options.keyRight.isDown() && !mc.options.keyLeft.isDown();

                if (left) {
                    NETWORK.sendToServer(new MovementPacket(MovementAction.LEFT_DASH));
                    startAnim("SIDE_DASH_LEFT", 6);
                } else if (right) {
                    NETWORK.sendToServer(new MovementPacket(MovementAction.RIGHT_DASH));
                    startAnim("SIDE_DASH_RIGHT", 6);
                } else {
                    NETWORK.sendToServer(new MovementPacket(MovementAction.FRONT_DASH));
                    startAnim("FRONT_DASH", 14);
                }
            }

            boolean speedHeld = ClientModEvents.SUPER_SPEED_KEY.isDown();
            if (speedHeld != lastSpeedHeld) {
                NETWORK.sendToServer(new MovementPacket(speedHeld ? MovementAction.SPEED_ON : MovementAction.SPEED_OFF));
                lastSpeedHeld = speedHeld;
            }


            if (hudMaxBlueActive) {
                if (mc.options.keyUp.isDown() && !mc.options.keyDown.isDown()) {
                    NETWORK.sendToServer(new MaxBlueControlPacket(MaxBlueControlAction.FARTHER));
                } else if (mc.options.keyDown.isDown() && !mc.options.keyUp.isDown()) {
                    NETWORK.sendToServer(new MaxBlueControlPacket(MaxBlueControlAction.CLOSER));
                }

                mc.player.input.forwardImpulse = 0.0F;
                mc.player.input.leftImpulse = 0.0F;
                mc.player.input.jumping = false;
                mc.player.setSprinting(false);
            }

            // Короткое нажатие и удержание 1 сек — разные способности.
            // Все базовые кнопки переназначаются через меню управления Minecraft.
            processBlueKey(ClientModEvents.BLUE_KEY, BLUE_STATE);
            processRedKey(ClientModEvents.RED_KEY, RED_STATE);
            processHoldKey(ClientModEvents.DOMAIN_KEY, Ability.INFINITY_TOGGLE, Ability.DOMAIN, DOMAIN_STATE, "CHARGE_DOMAIN");
            processHoldKey(ClientModEvents.UTILITY_KEY, Ability.RCT, Ability.TELEPORT, UTILITY_STATE, "CHARGE_TELEPORT");
        }

        @SubscribeEvent
        public static void onRenderGui(RenderGuiEvent.Post event) {
            // Без повязки мод не рисует вообще ничего поверх обычного Minecraft.
            if (!hudVisible || !hudBlindfold) return;

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
            drawSkillRow(g, mc, x + 8, sy, keyName(ClientModEvents.SUPER_SPEED_KEY), "Six Eyes Run", null);
            sy += 18;
            drawSkillRow(g, mc, x + 8, sy, keyName(ClientModEvents.BLUE_KEY), "Blue", "HOLD: Maximum Blue");
            sy += 18;
            drawSkillRow(g, mc, x + 8, sy, keyName(ClientModEvents.RED_KEY), "Red", "HOLD 2s: Maximum Red");
            sy += 18;
            drawSkillRow(g, mc, x + 8, sy, keyName(ClientModEvents.DOMAIN_KEY), "Infinity", "HOLD: Domain");
            sy += 18;
            drawSkillRow(g, mc, x + 8, sy, keyName(ClientModEvents.UTILITY_KEY), "RCT", "HOLD: Blink");
            sy += 18;
            drawSkillRow(g, mc, x + 8, sy, keyName(ClientModEvents.TELEPORT_KEY), "Teleport", "STUN 2s");

            if (hudBlueActive) {
                g.drawString(mc.font, "BLUE // ЛКМ: БРОСОК", x + 10, y + h - 30, 0xFF66DFFF, false);
            } else if (hudMaxBlueActive) {
                g.drawString(mc.font, "MAX BLUE // W/S: DISTANCE", x + 10, y + h - 30, 0xFF66DFFF, false);
            }

            if (hudInfinity) {
                g.drawString(mc.font, "INFINITY // ACTIVE", x + 10, y + h - 18, 0xFF6CEBFF, false);
            }

            if (hudBlindfold && jumpChargeTicks >= 20) {
                int jw = 84;
                int jx = sw / 2 - jw / 2;
                int jy = event.getWindow().getGuiScaledHeight() - 55;
                int tier = jumpChargeTicks >= 60 ? 3 : (jumpChargeTicks >= 40 ? 2 : 1);
                int fill = tier == 1 ? jw / 3 : (tier == 2 ? jw * 2 / 3 : jw);

                g.fill(jx - 2, jy - 2, jx + jw + 2, jy + 9, 0x99070A10);
                g.fill(jx, jy, jx + jw, jy + 7, 0xFF151B26);
                g.fill(jx, jy, jx + fill, jy + 7, 0xFF29D8FF);
                g.drawCenteredString(mc.font, "JUMP 7 / 13 / 18", sw / 2, jy - 10, 0xFFBDEFFF);
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
            // Без повязки руки рендерятся полностью ванильно.
            if (!hudBlindfold) return;

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
                case "MAX_RED" -> {
                    pose.translate(side * 0.14 * wave, -0.11 * wave, -0.46 * wave);
                    pose.mulPose(Axis.XP.rotationDegrees(-68.0f * wave));
                    pose.mulPose(Axis.YP.rotationDegrees(side * 16.0f * wave));
                    pose.mulPose(Axis.ZP.rotationDegrees(side * 28.0f * wave));
                }
                case "CURSED_BARRAGE" -> {
                    pose.translate(0, 0, -0.48 * wave);
                    pose.mulPose(Axis.XP.rotationDegrees(-22.0f * wave));
                    pose.mulPose(Axis.ZP.rotationDegrees(side * 10.0f * wave));
                }
                case "DOMAIN", "INFINITY_TOGGLE", "RCT", "TELEPORT" -> {
                    pose.translate(-side * 0.25 * wave, -0.17 * wave, -0.22 * wave);
                    pose.mulPose(Axis.XP.rotationDegrees(-48.0f * wave));
                    pose.mulPose(Axis.YP.rotationDegrees(side * 55.0f * wave));
                }
                case "FRONT_DASH" -> {
                    pose.translate(0.0, -0.03 * wave, -0.38 * wave);
                    pose.mulPose(Axis.XP.rotationDegrees(-28.0f * wave));
                }
                case "SIDE_DASH_LEFT" -> {
                    pose.translate(0.22 * wave, -0.02 * wave, -0.10 * wave);
                    pose.mulPose(Axis.ZP.rotationDegrees(-side * 24.0f * wave));
                }
                case "SIDE_DASH_RIGHT" -> {
                    pose.translate(-0.22 * wave, -0.02 * wave, -0.10 * wave);
                    pose.mulPose(Axis.ZP.rotationDegrees(side * 24.0f * wave));
                }
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