# **Clean Code guide**

## **Naming**

### **Names must reveal intent**
avoid vague or single-letter names unless the scope is tiny and instantly obvious.

#### **Bad**
```typescript
var d = 25
var p = 3
var t = d * p
print(t)
```

#### **Good**
```typescript
var damage_amount = 25
var number_of_projectiles = 3
var total_damage = damage_amount * number_of_projectiles
print(total_damage)
```

#### **Why**
The second example tells you exactly what each value means without needing comments or extra code tracing.

### **Names must not create disinformation**
Do not use names that imply the wrong type, shape, or behavior.

#### **Bad**
```typescript
var player_list = {
    "jake": 100,
    "mira": 85,
    "taro": 60
}

print(player_list["jake"])
```

#### **Good**
```typescript
var player_health_by_name = {
    "jake": 100,
    "mira": 85,
    "taro": 60
}

print(player_health_by_name["jake"])
```

#### **Why**
player_list sounds like an ordered Array, but the value is actually a Dictionary keyed by player name. That mismatch makes readers assume the wrong thing before they even inspect the code. Honest names reduce confusion, cut down tracing, and protect trust in the codebase.

### **Names must explain themselves before implementation**
Do not make readers open the function body just to learn what the game logic actually does.

#### **Bad**
```typescript
function doThing(enemies: Enemy[]) {
    return enemies.filter((enemy) => enemy.health > 0)
}

function run(items: Item[]) {
    return items.map((item) => item.gold_value)
}
```

#### **Good**
```typescript
function getLivingEnemies(enemies: Enemy[]) {
    return enemies.filter((enemy) => enemy.health > 0)
}

function getItemSellValues(items: Item[]) {
    return items.map((item) => item.gold_value)
}
```

#### **Why**
`doThing` and `run` say nothing about the actual gameplay behavior. A reader has to inspect the implementation to discover that one function filters alive enemies and the other extracts item sell values. `getLivingEnemies` and `getItemSellValues` reveal the game logic immediately, which makes combat, loot, and inventory code much easier to trust and maintain.

### **Names must sound like real gameplay language**
Use names that developers can say out loud, discuss naturally, and understand without decoding abbreviations.

#### **Bad**
```typescript
const plyrXpRwdByMobId = {
    slime: 25,
    skeleton_archer: 60,
    cave_troll: 180
}

function calcXpRwd(mobId: string) {
    return plyrXpRwdByMobId[mobId] ?? 0
}
```

#### **Good**
```typescript
const experienceRewardByEnemyId = {
    slime: 25,
    skeleton_archer: 60,
    cave_troll: 180
}

function getExperienceRewardForEnemy(enemyId: string) {
    return experienceRewardByEnemyId[enemyId] ?? 0
}
```

#### **Why**
`plyrXpRwdByMobId` and `calcXpRwd` force the reader to decode compressed shorthand before they can understand the gameplay logic. `experienceRewardByEnemyId` and `getExperienceRewardForEnemy` sound like real language, which makes the code easier to read, easier to discuss in a team, and easier to trust during combat and progression work.

### **Names must be searchable**
Use names you can quickly find in the codebase. Avoid tiny or generic names when the value matters beyond a tiny local scope.

#### **Bad**
```typescript
const data = {
    iron_sword: 25,
    steel_sword: 40,
    crystal_blade: 75
}

function get(id: string) {
    return data[id] ?? 0
}
```

#### **Good**
```typescript
const weaponDamageByItemId = {
    iron_sword: 25,
    steel_sword: 40,
    crystal_blade: 75
}

function getWeaponDamageByItemId(itemId: string) {
    return weaponDamageByItemId[itemId] ?? 0
}
```

#### **Why**
`data` and `get` are too generic to search for with confidence in a real game codebase. They will collide with dozens of unrelated results and force readers to rely on surrounding code for meaning. `weaponDamageByItemId` and `getWeaponDamageByItemId` are specific, searchable, and easy to trace when you are debugging combat, balancing items, or refactoring inventory systems.

### **Names must describe gameplay intent, not the variable type**
Do not encode the type into the name when the language and tooling already tell you that. Use the name to explain the game meaning instead.

#### **Bad**
```typescript
let iDamage = 35
let bIsCritical = true
let arrLootDrops = ["iron_ore", "leather_scrap", "wolf_fang"]

function calcDmg(iBaseDamage: number, bCriticalHit: boolean) {
    return bCriticalHit ? iBaseDamage * 2 : iBaseDamage
}
```

#### **Good**
```typescript
let damageAmount = 35
let isCriticalHit = true
let lootDropIds = ["iron_ore", "leather_scrap", "wolf_fang"]

function calculateDamage(baseDamage: number, isCriticalHit: boolean) {
    return isCriticalHit ? baseDamage * 2 : baseDamage
}
```

#### **Why**
`iDamage`, `bIsCritical`, and `arrLootDrops` spend naming space on type information that TypeScript and your editor already know. That leaves less room for the actual gameplay meaning. `damageAmount`, `isCriticalHit`, and `lootDropIds` tell the reader what the values represent in combat and loot logic, which makes the code easier to read, discuss, and maintain.

### **Names must not force decoding**
Do not compress gameplay meaning into cryptic shorthand. A good name should read clearly the first time.

#### **Bad**
```typescript
const dmgModCfg = {
    fire_staff: 1.25,
    iron_sword: 1.0,
    frost_dagger: 1.1
}

function calcAtkMod(eqId: string) {
    return dmgModCfg[eqId] ?? 1.0
}
```

#### **Good**
```typescript
const damageModifierByEquipmentId = {
    fire_staff: 1.25,
    iron_sword: 1.0,
    frost_dagger: 1.1
}

function getDamageModifierForEquipment(equipmentId: string) {
    return damageModifierByEquipmentId[equipmentId] ?? 1.0
}
```

#### **Why**
`dmgModCfg` and `calcAtkMod` make the reader stop and decode shortened words before they can understand the combat logic. `damageModifierByEquipmentId` and `getDamageModifierForEquipment` say exactly what the data and function represent, which makes balancing, debugging, and combat tuning much easier to follow.

## **Functions**

### **Functions must keep gameplay logic visible**
Do not bury the main gameplay outcome under setup, checks, loops, and side effects. Extract low-level work so the main function reads like the feature.

#### **Bad**
```typescript
function completeQuest(player: Player, quest: Quest, rewards: RewardTable) {
    if (quest.is_completed) {
        return
    }

    let hasAllObjectives = true

    for (const objective of quest.objectives) {
        const currentProgress = player.objectiveProgress[objective.id] ?? 0
        if (currentProgress < objective.requiredAmount) {
            hasAllObjectives = false
        }
    }

    if (!hasAllObjectives) {
        return
    }

    quest.is_completed = true

    for (const reward of rewards.entries) {
        if (reward.type === "gold") {
            player.gold += reward.amount
        }

        if (reward.type === "experience") {
            player.experience += reward.amount
        }

        if (reward.type === "item") {
            const currentAmount = player.inventory[reward.itemId] ?? 0
            player.inventory[reward.itemId] = currentAmount + reward.amount
        }
    }

    player.completedQuestIds.push(quest.id)
    savePlayerProfile(player)
    showQuestCompleteBanner(quest.title)
}
```

#### **Good**
```typescript
function completeQuest(player: Player, quest: Quest, rewards: RewardTable) {
    if (quest.is_completed) {
        return
    }

    if (!hasCompletedAllQuestObjectives(player, quest)) {
        return
    }

    markQuestAsCompleted(player, quest)
    grantQuestRewards(player, rewards)
    savePlayerProfile(player)
    showQuestCompleteBanner(quest.title)
}

function hasCompletedAllQuestObjectives(player: Player, quest: Quest) {
    for (const objective of quest.objectives) {
        const currentProgress = player.objectiveProgress[objective.id] ?? 0

        if (currentProgress < objective.requiredAmount) {
            return false
        }
    }

    return true
}

function markQuestAsCompleted(player: Player, quest: Quest) {
    quest.is_completed = true
    player.completedQuestIds.push(quest.id)
}

function grantQuestRewards(player: Player, rewards: RewardTable) {
    for (const reward of rewards.entries) {
        if (reward.type === "gold") {
            player.gold += reward.amount
        }

        if (reward.type === "experience") {
            player.experience += reward.amount
        }

        if (reward.type === "item") {
            const currentAmount = player.inventory[reward.itemId] ?? 0
            player.inventory[reward.itemId] = currentAmount + reward.amount
        }
    }
}
```

#### **Why**
The bad example mixes objective validation, reward distribution, persistence, and UI feedback into one large block, which hides the real gameplay flow. The good example makes the main function read like a quest-completion checklist, so the reader can understand the feature before diving into the lower-level details.

### **Functions must do one thing**
If a function can be broken into separate named sections, it is handling more than one responsibility and should be split apart.

#### **Bad**
```typescript
function respawnPlayerAfterDeath(player: Player, spawnPoint: SpawnPoint) {
    player.health = player.maxHealth
    player.mana = player.maxMana
    player.stamina = player.maxStamina

    player.position = spawnPoint.position
    player.isDead = false
    player.activeStatusEffectIds = []

    playSound("player_respawn")
    showRespawnVfx(spawnPoint.position)
    showNotification("You have respawned")

    savePlayerProfile(player)
}
```

#### **Good**
```typescript
function respawnPlayerAfterDeath(player: Player, spawnPoint: SpawnPoint) {
    restorePlayerResources(player)
    movePlayerToSpawnPoint(player, spawnPoint)
    clearDeathState(player)
    playRespawnFeedback(spawnPoint)
    savePlayerProfile(player)
}

function restorePlayerResources(player: Player) {
    player.health = player.maxHealth
    player.mana = player.maxMana
    player.stamina = player.maxStamina
}

function movePlayerToSpawnPoint(player: Player, spawnPoint: SpawnPoint) {
    player.position = spawnPoint.position
}

function clearDeathState(player: Player) {
    player.isDead = false
    player.activeStatusEffectIds = []
}

function playRespawnFeedback(spawnPoint: SpawnPoint) {
    playSound("player_respawn")
    showRespawnVfx(spawnPoint.position)
    showNotification("You have respawned")
}
```

#### **Why**
The bad example mixes resource recovery, movement, state cleanup, feedback, and persistence in one block. That makes the reader mentally split the function into sections just to understand it. The good example gives each responsibility its own function, so the main flow reads clearly and the low-level details stay isolated.

### **Functions must not mix levels of abstraction**
Keep gameplay intent and low-level implementation at the same level inside a function. Do not jump back and forth between feature logic and tiny technical details.

#### **Bad**
```typescript
function openTreasureChest(player: Player, chest: TreasureChest) {
    if (!player.inventory.hasFreeSlot) {
        showNotification("Inventory full")
        return
    }

    const randomRewardIndex = Math.floor(Math.random() * chest.rewardTable.length)
    const selectedReward = chest.rewardTable[randomRewardIndex]

    const currentAmount = player.inventory.items[selectedReward.itemId] ?? 0
    player.inventory.items[selectedReward.itemId] = currentAmount + selectedReward.amount

    chest.isOpened = true
    chest.sprite.play("open")
    playSound("chest_open")
    showLootPopup(selectedReward.itemId, selectedReward.amount)
}
```

#### **Good**
```typescript
function openTreasureChest(player: Player, chest: TreasureChest) {
    if (!player.inventory.hasFreeSlot) {
        showNotification("Inventory full")
        return
    }

    const selectedReward = rollTreasureChestReward(chest)
    addRewardToInventory(player, selectedReward)
    markTreasureChestAsOpened(chest)
    showTreasureChestReward(selectedReward)
}

function rollTreasureChestReward(chest: TreasureChest) {
    const randomRewardIndex = Math.floor(Math.random() * chest.rewardTable.length)
    return chest.rewardTable[randomRewardIndex]
}

function addRewardToInventory(player: Player, reward: ChestReward) {
    const currentAmount = player.inventory.items[reward.itemId] ?? 0
    player.inventory.items[reward.itemId] = currentAmount + reward.amount
}

function markTreasureChestAsOpened(chest: TreasureChest) {
    chest.isOpened = true
    chest.sprite.play("open")
    playSound("chest_open")
}

function showTreasureChestReward(reward: ChestReward) {
    showLootPopup(reward.itemId, reward.amount)
}
```

#### **Why**
The bad example jumps between gameplay intent like opening a chest, low-level inventory mutation, animation playback, and reward presentation. That constant shift in abstraction makes the flow harder to read. The good example keeps the main function at the feature level, so the chest-opening sequence reads clearly before the reader dives into implementation details.

### **Functions must bury switch logic**
Do not let high-level gameplay flow get buried under branch-heavy selection logic. Hide the switch behind an intention-revealing function so the main feature reads cleanly.

#### **Bad**
```typescript
function playFootstepSound(surfaceType: string) {
    switch (surfaceType) {
        case "grass":
            audio.play("footstep_grass")
            break
        case "stone":
            audio.play("footstep_stone")
            break
        case "wood":
            audio.play("footstep_wood")
            break
        case "water":
            audio.play("footstep_water")
            break
        default:
            audio.play("footstep_default")
            break
    }
}

function handlePlayerMovement(player: Player, surfaceType: string) {
    updatePlayerPosition(player)
    reduceStaminaWhileSprinting(player)
    playFootstepSound(surfaceType)
}
```

#### **Good**
```typescript
function handlePlayerMovement(player: Player, surfaceType: string) {
    updatePlayerPosition(player)
    reduceStaminaWhileSprinting(player)
    playSurfaceFootstepSound(surfaceType)
}

function playSurfaceFootstepSound(surfaceType: string) {
    audio.play(getFootstepSoundIdForSurface(surfaceType))
}

function getFootstepSoundIdForSurface(surfaceType: string) {
    switch (surfaceType) {
        case "grass":
            return "footstep_grass"
        case "stone":
            return "footstep_stone"
        case "wood":
            return "footstep_wood"
        case "water":
            return "footstep_water"
        default:
            return "footstep_default"
    }
}
```

#### **Why**
The bad example exposes branch-heavy selection logic directly in the gameplay path, which makes the reader stop thinking about movement and start decoding implementation details. The good example keeps the movement flow at a high level and hides the switch behind a clear function name, so the main logic stays easy to read and the branching stays isolated.

### **Functions must keep argument counts low**
Every extra parameter adds mental load. Prefer function calls that are easy to read, easy to remember, and hard to misuse.

#### **Bad**
```typescript
function spawnEnemy(
    enemyType: string,
    level: number,
    positionX: number,
    positionY: number,
    shouldPlaySpawnVfx: boolean,
    shouldAggroNearestPlayer: boolean
) {
    const enemy = createEnemy(enemyType, level)
    enemy.position.x = positionX
    enemy.position.y = positionY

    if (shouldPlaySpawnVfx) {
        playSpawnVfx(positionX, positionY)
    }

    if (shouldAggroNearestPlayer) {
        enemy.target = findNearestPlayer(enemy.position)
    }

    addEnemyToWorld(enemy)
}
```

#### **Good**
```typescript
type EnemySpawnRequest = {
    enemyType: string
    level: number
    position: Vector2
    shouldPlaySpawnVfx: boolean
    shouldAggroNearestPlayer: boolean
}

function spawnEnemy(spawnRequest: EnemySpawnRequest) {
    const enemy = createEnemy(spawnRequest.enemyType, spawnRequest.level)
    enemy.position = spawnRequest.position

    if (spawnRequest.shouldPlaySpawnVfx) {
        playSpawnVfx(spawnRequest.position.x, spawnRequest.position.y)
    }

    if (spawnRequest.shouldAggroNearestPlayer) {
        enemy.target = findNearestPlayer(enemy.position)
    }

    addEnemyToWorld(enemy)
}
```

#### **Why**
The bad example forces the reader to remember a long list of ordered arguments and what each one means. That makes the call harder to read and easier to misuse. The good example reduces mental load by grouping related spawn data into one named object, which makes the function call clearer and safer in gameplay code.

### **Functions should prefer a single argument**
A function is easiest to understand when it takes one clear input. Single-argument functions work especially well when they ask something, transform something, or handle something.

#### **Bad**
```typescript
function applyBurningDamage(
    target: Enemy,
    damagePerSecond: number,
    durationSeconds: number,
    shouldShowVfx: boolean
) {
    target.activeEffects.push({
        type: "burning",
        damagePerSecond: damagePerSecond,
        durationSeconds: durationSeconds
    })

    if (shouldShowVfx) {
        showStatusEffectVfx(target, "burning")
    }
}
```

#### **Good**
```typescript
type BurningEffectRequest = {
    target: Enemy
    damagePerSecond: number
    durationSeconds: number
    shouldShowVfx: boolean
}

function applyBurningEffect(effectRequest: BurningEffectRequest) {
    effectRequest.target.activeEffects.push({
        type: "burning",
        damagePerSecond: effectRequest.damagePerSecond,
        durationSeconds: effectRequest.durationSeconds
    })

    if (effectRequest.shouldShowVfx) {
        showStatusEffectVfx(effectRequest.target, "burning")
    }
}
```

#### **Why**
The bad example makes the reader track several separate arguments and remember what each one means at the call site. The good example groups the effect data into one clear input, which makes the function easier to read, easier to pass around, and less error-prone when working with gameplay status effects.

### **Functions must make argument groups obvious**
Not every pair or trio of arguments naturally belongs together. When several values describe one gameplay action, name that group clearly so the call is easier to read and harder to misuse.

#### **Bad**
```typescript
function launchProjectile(
    projectileId: string,
    positionX: number,
    positionY: number,
    directionX: number,
    directionY: number,
    speed: number
) {
    const projectile = createProjectile(projectileId)
    projectile.position.x = positionX
    projectile.position.y = positionY
    projectile.direction.x = directionX
    projectile.direction.y = directionY
    projectile.speed = speed
    addProjectileToWorld(projectile)
}
```

#### **Good**
```typescript
type ProjectileLaunchRequest = {
    projectileId: string
    spawnPosition: Vector2
    direction: Vector2
    speed: number
}

function launchProjectile(launchRequest: ProjectileLaunchRequest) {
    const projectile = createProjectile(launchRequest.projectileId)
    projectile.position = launchRequest.spawnPosition
    projectile.direction = launchRequest.direction
    projectile.speed = launchRequest.speed
    addProjectileToWorld(projectile)
}
```

#### **Why**
The bad example passes several loose values that the reader has to mentally group into position, direction, and speed. That makes the call harder to read and easier to mix up. The good example names the related data as a single gameplay concept, so the function call becomes clearer and the meaning of each value stays obvious.

### **Functions must not hide side effects**
If a function changes game state or talks to external systems, make that obvious. Do not give it a harmless name if it also saves, syncs, logs, or mutates data.

#### **Bad**
```typescript
function getEquippedWeaponId(player: Player) {
    savePlayerProfile(player)
    syncLoadoutToServer(player)
    analytics.track("weapon_checked", {
        playerId: player.id,
        weaponId: player.equipment.weaponId
    })

    return player.equipment.weaponId
}
```

#### **Good**
```typescript
function getEquippedWeaponId(player: Player) {
    return player.equipment.weaponId
}

function syncPlayerLoadout(player: Player) {
    savePlayerProfile(player)
    syncLoadoutToServer(player)
    analytics.track("loadout_synced", {
        playerId: player.id,
        weaponId: player.equipment.weaponId
    })
}
```

#### **Why**
The bad example looks like a simple read, but it secretly saves data, syncs to the server, and sends analytics. That makes the function misleading and dangerous to call casually. The good example keeps the read-only query separate from the side-effect-heavy command, so the intent stays honest and the behavior stays predictable.

### **Functions must either do or answer**
A function should either change gameplay state or return information, but not both in the same call.

#### **Bad**
```typescript
function equipWeapon(player: Player, weaponId: string) {
    const canEquipWeapon = player.inventory.weaponIds.includes(weaponId)

    if (!canEquipWeapon) {
        return false
    }

    player.equipment.weaponId = weaponId
    savePlayerProfile(player)
    return true
}
```

#### **Good**
```typescript
function canEquipWeapon(player: Player, weaponId: string) {
    return player.inventory.weaponIds.includes(weaponId)
}

function equipWeapon(player: Player, weaponId: string) {
    player.equipment.weaponId = weaponId
    savePlayerProfile(player)
}
```

#### **Why**
The bad example asks a question and performs a state-changing action in the same function. That makes the call harder to reason about because it both decides and mutates. The good example separates the query from the command, which keeps the code easier to read, easier to test, and safer to call in gameplay systems.

### **Functions must not return error codes**
Do not force gameplay logic to decode failure states from special return values. Use exceptions when something has gone wrong so the happy path stays easy to read.

#### **Bad**
```typescript
const INVENTORY_FULL_ERROR = -1

function addItemToInventory(player: Player, itemId: string, amount: number) {
    const currentUsedSlots = getUsedInventorySlots(player)
    const maxSlots = getMaxInventorySlots(player)

    if (currentUsedSlots >= maxSlots) {
        return INVENTORY_FULL_ERROR
    }

    const currentAmount = player.inventory[itemId] ?? 0
    player.inventory[itemId] = currentAmount + amount
    return currentAmount + amount
}

function lootChest(player: Player, itemId: string, amount: number) {
    const result = addItemToInventory(player, itemId, amount)

    if (result === INVENTORY_FULL_ERROR) {
        showNotification("Inventory full")
        return
    }

    playSound("loot_pickup")
    showLootPopup(itemId, amount)
}
```

#### **Good**
```typescript
class InventoryFullError extends Error {}

function addItemToInventory(player: Player, itemId: string, amount: number) {
    const currentUsedSlots = getUsedInventorySlots(player)
    const maxSlots = getMaxInventorySlots(player)

    if (currentUsedSlots >= maxSlots) {
        throw new InventoryFullError("Inventory full")
    }

    const currentAmount = player.inventory[itemId] ?? 0
    player.inventory[itemId] = currentAmount + amount
    return currentAmount + amount
}

function lootChest(player: Player, itemId: string, amount: number) {
    try {
        addItemToInventory(player, itemId, amount)
        playSound("loot_pickup")
        showLootPopup(itemId, amount)
    } catch (error) {
        if (error instanceof InventoryFullError) {
            showNotification("Inventory full")
            return
        }

        throw error
    }
}
```

#### **Why**
The bad example forces the caller to remember and check a special error value before it can continue. That makes the gameplay flow harder to read and easier to misuse. The good example keeps the success path clean and handles failure as an actual exceptional case, which makes the function behavior clearer and the calling code easier to follow.

### **Functions must not duplicate logic**
Do not repeat the same gameplay rule in multiple functions. Shared behavior should live in one place so fixes and balance changes only need to happen once.

#### **Bad**
```typescript
function calculateSwordDamage(player: Player) {
    const strengthBonus = player.strength * 2
    const weaponDamage = player.equipment.weaponDamage
    const criticalBonus = player.isCriticalHit ? 10 : 0

    return weaponDamage + strengthBonus + criticalBonus
}

function calculateAxeDamage(player: Player) {
    const strengthBonus = player.strength * 2
    const weaponDamage = player.equipment.weaponDamage
    const criticalBonus = player.isCriticalHit ? 10 : 0

    return weaponDamage + strengthBonus + criticalBonus
}
```

#### **Good**
```typescript
function calculateWeaponDamage(player: Player) {
    const strengthBonus = player.strength * 2
    const weaponDamage = player.equipment.weaponDamage
    const criticalBonus = player.isCriticalHit ? 10 : 0

    return weaponDamage + strengthBonus + criticalBonus
}

function calculateSwordDamage(player: Player) {
    return calculateWeaponDamage(player)
}

function calculateAxeDamage(player: Player) {
    return calculateWeaponDamage(player)
}
```

#### **Why**
The bad example repeats the same combat formula in multiple places, which means a balance change or bug fix has to be updated everywhere. That duplication makes it easy for one copy to drift and create inconsistent gameplay. The good example keeps the damage rule in one place, which makes combat tuning safer, faster, and easier to trust.

### **Functions must not ship as first drafts**
It is fine for a function to start messy while you figure out the gameplay logic. It is not fine to leave it messy once the behavior is understood.

#### **Bad**
```typescript
function updateBossPhase(boss: Boss, player: Player) {
    if (boss.health <= boss.maxHealth * 0.5) {
        boss.phase = 2
    }

    if (boss.phase === 2) {
        if (!boss.hasSpawnedMinions) {
            spawnEnemy("shadow_minion", boss.position.x - 2, boss.position.y)
            spawnEnemy("shadow_minion", boss.position.x + 2, boss.position.y)
            boss.hasSpawnedMinions = true
        }

        if (distanceBetween(boss.position, player.position) < 4) {
            player.health -= boss.phaseTwoMeleeDamage
        } else {
            createProjectile("shadow_bolt", boss.position, getDirectionToTarget(boss.position, player.position))
        }

        if (boss.health <= boss.maxHealth * 0.2) {
            boss.moveSpeed = boss.enragedMoveSpeed
            boss.attackRate = boss.enragedAttackRate
        }
    }
}
```

#### **Good**
```typescript
function updateBossPhase(boss: Boss, player: Player) {
    enterSecondBossPhaseWhenHealthIsLow(boss)
    runSecondBossPhaseBehavior(boss, player)
    applyEnragedBossStateWhenHealthIsCritical(boss)
}

function enterSecondBossPhaseWhenHealthIsLow(boss: Boss) {
    if (boss.health > boss.maxHealth * 0.5) {
        return
    }

    boss.phase = 2
}

function runSecondBossPhaseBehavior(boss: Boss, player: Player) {
    if (boss.phase !== 2) {
        return
    }

    spawnPhaseTwoMinionsOnce(boss)
    performPhaseTwoAttack(boss, player)
}

function spawnPhaseTwoMinionsOnce(boss: Boss) {
    if (boss.hasSpawnedMinions) {
        return
    }

    spawnEnemy("shadow_minion", boss.position.x - 2, boss.position.y)
    spawnEnemy("shadow_minion", boss.position.x + 2, boss.position.y)
    boss.hasSpawnedMinions = true
}

function performPhaseTwoAttack(boss: Boss, player: Player) {
    if (distanceBetween(boss.position, player.position) < 4) {
        player.health -= boss.phaseTwoMeleeDamage
        return
    }

    createProjectile("shadow_bolt", boss.position, getDirectionToTarget(boss.position, player.position))
}

function applyEnragedBossStateWhenHealthIsCritical(boss: Boss) {
    if (boss.health > boss.maxHealth * 0.2) {
        return
    }

    boss.moveSpeed = boss.enragedMoveSpeed
    boss.attackRate = boss.enragedAttackRate
}
```

#### **Why**
The bad example looks like a raw first pass that was never cleaned up. It mixes phase transitions, one-time spawning, attack behavior, and enraged-state tuning in one block. The good example keeps the same gameplay logic, but rewrites it into smaller intention-revealing functions so the boss behavior is easier to read, test, and change.

## **Comments**

### **Comments must not go stale**
Do not write comments that can quietly become lies when the gameplay code changes. If the code can explain itself clearly, prefer that over a fragile comment.

#### **Bad**
```typescript
// Give the player 100 gold for clearing the dungeon
function grantDungeonClearReward(player: Player) {
    player.gold += 250
    player.inventory.push("shadow_key")
}
```

#### **Good**
```typescript
const DUNGEON_CLEAR_GOLD_REWARD = 250
const DUNGEON_CLEAR_BONUS_ITEM_ID = "shadow_key"

function grantDungeonClearReward(player: Player) {
    player.gold += DUNGEON_CLEAR_GOLD_REWARD
    player.inventory.push(DUNGEON_CLEAR_BONUS_ITEM_ID)
}
```

#### **Why**
The bad example contains a comment that has fallen out of sync with the real gameplay reward. A reader now has two sources of truth, and one of them is wrong. The good example removes the fragile explanation and lets clear names document the reward directly, which makes the code easier to trust when balance values change.

### **Comments must explain why, not what**
Do not use comments to narrate what the code already says. Use comments for design intent, constraints, or reasons the reader cannot infer from the implementation alone.

#### **Bad**
```typescript
function despawnInactiveEnemies(enemies: Enemy[]) {
    // Loop through all enemies
    for (const enemy of enemies) {
        // Check if the enemy has been inactive for too long
        if (enemy.secondsSinceLastSeen > 30) {
            // Remove the enemy from the world
            removeEnemyFromWorld(enemy)
        }
    }
}
```

#### **Good**
```typescript
function despawnInactiveEnemies(enemies: Enemy[]) {
    for (const enemy of enemies) {
        if (enemy.secondsSinceLastSeen > 30) {
            // Keep the world state light for multiplayer sessions when players kite enemies far off-screen.
            removeEnemyFromWorld(enemy)
        }
    }
}
```

#### **Why**
The bad example wastes comments on things the code already makes obvious, which adds noise without adding understanding. The good example uses the comment to explain the gameplay and networking reason behind the despawn rule, which is information the code alone does not reveal.

### **Comments must warn about non-obvious traps**
Use comments when the code looks wrong for a reason and a future cleanup could silently break gameplay. A good warning comment protects important intent from well-meaning changes.

#### **Bad**
```typescript
function updatePortalCooldown(portal: Portal) {
    portal.cooldownSeconds = 0
}
```

#### **Good**
```typescript
function updatePortalCooldown(portal: Portal) {
    // Do not clamp this to 0. Negative cooldown keeps linked portals in sync
    // for one extra tick and prevents duplicate teleports in multiplayer.
    portal.cooldownSeconds = -1
}
```

#### **Why**
The bad example gives no hint that the unusual value is intentional, so a future developer may “fix” it and introduce a hard-to-find bug. The good example documents the non-obvious reason behind the strange-looking code, which helps protect important gameplay behavior from accidental cleanup.

### **Comments may use TODOs for real follow-up work**
Use a TODO comment only when it marks a specific unfinished task that still needs to happen. It should point to real future work, not excuse messy code forever.

#### **Bad**
```typescript
function spawnWorldBoss() {
    // TODO: clean this up later
    boss.health = 5000
    boss.damage = 120
    boss.position = getWorldBossSpawnPosition()
    addBossToWorld(boss)
}
```

#### **Good**
```typescript
function spawnWorldBoss() {
    // TODO: Replace hardcoded boss stats with values from the balance data table before release.
    boss.health = 5000
    boss.damage = 120
    boss.position = getWorldBossSpawnPosition()
    addBossToWorld(boss)
}
```

#### **Why**
The bad example uses TODO as a vague promise that tells the reader nothing useful. The good example names the exact unfinished work, which makes the comment actionable and gives future developers a clear reason to revisit that spot.

### **Comments must document public-facing code**
Internal gameplay code should explain itself through names and structure. But when other developers use your API, command, or system from the outside, comments should explain how to use it.

#### **Bad**
```typescript
export function teleportPlayerToRealm(
    playerId: string,
    realmId: string,
    spawnPointId?: string
) {
    const realm = getRealmById(realmId)
    const spawnPosition = spawnPointId
        ? getRealmSpawnPointPosition(realm, spawnPointId)
        : getDefaultRealmSpawnPosition(realm)

    movePlayerToPosition(playerId, spawnPosition)
}
```

#### **Good**
```typescript
/**
 * Teleports a player to a target realm.
 *
 * Use spawnPointId to send the player to a specific spawn point.
 * If spawnPointId is omitted, the realm's default spawn position is used.
 */
export function teleportPlayerToRealm(
    playerId: string,
    realmId: string,
    spawnPointId?: string
) {
    const realm = getRealmById(realmId)
    const spawnPosition = spawnPointId
        ? getRealmSpawnPointPosition(realm, spawnPointId)
        : getDefaultRealmSpawnPosition(realm)

    movePlayerToPosition(playerId, spawnPosition)
}
```

#### **Why**
The bad example may be readable to the team maintaining the code, but it gives outside users no quick explanation of how the function should be called. The good example adds documentation at the public boundary, where readers need usage rules and behavior details without digging through the implementation.

### **Comments must not add noise**
Do not write comments that repeat what the gameplay code already makes obvious. If a comment adds no new insight, it is clutter.

#### **Bad**
```typescript
function unlockDoor(door: Door) {
    // Set the door to unlocked
    door.isLocked = false

    // Play the unlock sound
    playSound("door_unlock")

    // Show the unlock effect
    showUnlockEffect(door.position)
}
```

#### **Good**
```typescript
function unlockDoor(door: Door) {
    door.isLocked = false
    playSound("door_unlock")
    showUnlockEffect(door.position)
}
```

#### **Why**
The bad example uses comments to narrate actions the code already states clearly. That adds visual clutter without improving understanding. The good example removes the noise and lets the code speak for itself, which makes the function faster to read and easier to trust.

### **Comments must not be technically true but misleading**
A comment is not safe just because it is factually correct. If it causes the reader to misunderstand the real gameplay rule, it is still a bad comment.

#### **Bad**
```typescript
function applyMovementPenalty(player: Player) {
    // Heavy armor reduces movement speed.
    player.movementSpeed *= 0.9
}
```

#### **Good**
```typescript
function applyMovementPenalty(player: Player) {
    // Applies the global equipment slowdown modifier.
    // Heavy armor is one source of this penalty, but debuffs and encumbrance can also stack into it.
    player.movementSpeed *= 0.9
}
```

#### **Why**
The bad comment is technically true in some cases, but it is misleading because it makes the reader think heavy armor is the only reason for the slowdown. The good comment explains the broader gameplay rule, so the reader understands the real source of the behavior instead of walking away with the wrong mental model.

### **Comments must not preserve dead code**
Do not leave old gameplay code commented out in the file. If you need the old version later, version control already has it.

#### **Bad**
```typescript
function applyFallDamage(player: Player, fallDistance: number) {
    // const damageAmount = fallDistance * 2
    // player.health -= damageAmount

    const damageAmount = Math.max(0, fallDistance - 3) * 5
    player.health -= damageAmount
}
```

#### **Good**
```typescript
function applyFallDamage(player: Player, fallDistance: number) {
    const damageAmount = Math.max(0, fallDistance - 3) * 5
    player.health -= damageAmount
}
```

#### **Why**
The bad example leaves an old combat rule behind as commented-out code, which creates noise and makes the reader wonder whether that logic still matters. The good example keeps only the active gameplay rule in the file and relies on version control for history, which makes the function easier to read and trust.

### **Comments must not apologize for bad structure**
Do not use comments to excuse a tangled gameplay function. If a comment is needed to explain the shape of the code, the structure should be cleaned up instead.

#### **Bad**
```typescript
function activateAncientPortal(player: Player, portal: Portal) {
    // This is a bit messy, but this block validates the player,
    // consumes the shards, powers the portal, and handles the effects.
    if (player.inventory.portal_shard === undefined || player.inventory.portal_shard < 3) {
        showNotification("You need more portal shards")
        return
    }

    player.inventory.portal_shard -= 3
    portal.isActive = true
    portal.energyLevel = 100
    savePlayerProfile(player)
    savePortalState(portal)
    playSound("portal_activate")
    showPortalVfx(portal.position)
    showNotification("Ancient portal activated")
}
```

#### **Good**
```typescript
function activateAncientPortal(player: Player, portal: Portal) {
    if (!hasEnoughPortalShards(player)) {
        showNotification("You need more portal shards")
        return
    }

    consumePortalShards(player, 3)
    powerAncientPortal(portal)
    persistPortalActivation(player, portal)
    playPortalActivationFeedback(portal)
}

function hasEnoughPortalShards(player: Player) {
    return (player.inventory.portal_shard ?? 0) >= 3
}

function consumePortalShards(player: Player, requiredShardCount: number) {
    player.inventory.portal_shard -= requiredShardCount
}

function powerAncientPortal(portal: Portal) {
    portal.isActive = true
    portal.energyLevel = 100
}

function persistPortalActivation(player: Player, portal: Portal) {
    savePlayerProfile(player)
    savePortalState(portal)
}

function playPortalActivationFeedback(portal: Portal) {
    playSound("portal_activate")
    showPortalVfx(portal.position)
    showNotification("Ancient portal activated")
}
```

#### **Why**
The bad example uses a comment to apologize for a function that is doing too much in one place. That comment is a signal that the structure is carrying too many responsibilities at once. The good example removes the need for the apology by splitting the gameplay flow into clear steps, so the code explains itself without leaning on a rescue comment.

### **Comments must use plain language**
Do not make readers decode slang, symbols, or clever formatting inside comments. A good comment should be instantly readable wherever the code is viewed.

#### **Bad**
```typescript
function openRaidGate(player: Player, gate: RaidGate) {
    // !!! REQ: 3x void keys b4 u can pop this bad boy !!!
    if ((player.inventory.void_key ?? 0) < 3) {
        showNotification("You need more void keys")
        return
    }

    gate.isOpen = true
}
```

#### **Good**
```typescript
function openRaidGate(player: Player, gate: RaidGate) {
    // Requires 3 void keys before the raid gate can be opened.
    if ((player.inventory.void_key ?? 0) < 3) {
        showNotification("You need more void keys")
        return
    }

    gate.isOpen = true
}
```

#### **Why**
The bad example forces the reader to decode shorthand and informal phrasing before they can understand the gameplay rule. That slows people down and can become even harder to read across tools, editors, or teams. The good example uses plain language, so the requirement is obvious the moment the reader sees it.

### **Comments must not explain code that should be refactored**
Do not add a comment to rescue unclear gameplay code when a better name or a smaller function would make the intent obvious.

#### **Bad**
```typescript
function updatePlayerState(player: Player) {
    // Check if the player is low enough to trigger healing.
    if (player.health <= player.maxHealth * 0.25) {
        player.health += player.healthRegenPerSecond * getDeltaTime()
    }
}
```

#### **Good**
```typescript
function updatePlayerState(player: Player) {
    regenerateHealthWhenPlayerIsInCriticalState(player)
}

function regenerateHealthWhenPlayerIsInCriticalState(player: Player) {
    if (player.health > player.maxHealth * 0.25) {
        return
    }

    player.health += player.healthRegenPerSecond * getDeltaTime()
}
```

#### **Why**
The bad example uses a comment to explain behavior that should have been made clear by the code itself. The good example removes the need for the comment by extracting the logic into an intention-revealing function, so the gameplay flow is readable without extra narration.