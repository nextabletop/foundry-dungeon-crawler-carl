# Dungeon Crawler Carl Foundry VTT system

An official Foundry VTT **v14** game system. System id: `dungeon-crawler-carl`

Actor types: **Crawler** (`pc`), **Mob** (`mob`), and **Vehicle / Mount** (`vehicle`). Item types: weapon, skill, spell, gear.

On Mob sheets, the Combat pencil reveals editable bases while keeping totals visible. Surprise and Evade add Floor, and Move combines effective Move and Step. Mobs with a Spell show a manually editable mana pool; enter current and maximum mana before casting.

For Mob token sizing, include a numbered size such as `Tiny (1)` or `Large (5)` in Descriptors. New tokens use Roll20's size map relative to a 70-pixel grid; the number determines the size. Editing the size updates the prototype for future tokens, but does not resize tokens already on a scene. Without a numbered size, the prototype's dimensions are used.

On Crawler sheets, the Abilities pencil reveals the Unenhanced score inputs. The Combat Edit control reveals Armor, Move Base, Step Base, AI Favor, and Size inputs. Move and Step totals remain visible while editing; Evade can still be rolled from its total.

Mob To-Hit is set per Attack: open the Attack to edit its base or mark it as having no To-Hit. The displayed target applies attack modifiers and adds Floor; new Mob Attacks seed their base from Ability and Rank.

Damage buttons capitalize the damage type for Crawlers, Mobs, and Vehicles (for example, `1d6+2 Bludgeoning`). Stored damage types and roll formulas are unchanged.

Crawler Attack rows group Rank, Mod (the ability modifier, for example, 2), and To Hit in compact columns to leave more room for the name. Rank and Mod omit the leading plus; To Hit retains it. Populated Range appears beneath each Attack, including alternate uses, in the same style as Skill and Spell metadata. Attack To-Hit and Damage have separate roll buttons. Attacks without damage show plain No Damage text, including alternate uses and vehicle attacks; flat or dice damage modifiers still produce a damage roll.

Crawler Skill and Spell rows show effective Rank, Stat & Mod (for example, STR +2), check Type, Roll, and Used. The Mods checkbox is available on the item sheet instead; Mob rows retain their compact layout. Edit the item to change its details or hotlist membership. Passive entries post their notes with the chat icon; Passive spells still spend mana.

Crawler Skills and Spells share one Skills & Spells list. Add Skill / Spell asks which Item type to create; existing Items keep their types and casting behavior. Skills appear first, followed by Spells, with drag sorting preserved within each type. Mob lists remain separate.

Passive Skills and Spells display "-" under Stat & Mod. Set no-roll Spells such as Puddle Jumper and Torch to the Passive check type; their chat-icon cast action spends mana without rolling dice. Passive Skills post their notes without rolling. Their stored Ability is retained in case the check type is changed later.

Crawler Inventory rows omit the Hot checkbox. Open the Gear or Weapon item sheet to change hotlist membership; existing hotlist selections remain unchanged.

Spell-granted Attacks use the default Spell icon. Existing spell-linked Attacks with the default Attack icon display the Spell icon instead, while custom artwork is preserved. The Mod column contains only the numeric modifier, without a spell marker.

Dropping an attack-marked Skill or Spell creates a linked Attack with its authored base damage, damage Ability, damage type, Range, and Notes. Checking Is Attack reveals inline Damage Die, Damage Ability, and Damage Type fields on the Skill/Spell form. Source JSON stores these in `system.attackDefaults`; they seed newly created Attacks, not existing ones. This damage copy is one-way: editing an Attack's damage never changes its source Skill/Spell. For example, Axe creates `1d6` + Strength Slashing, and Magic Missile creates `1d4` + Intelligence Force. Ability and Rank still come from the source, except Passive Skills create Attacks with no To-Hit Ability. Refresh the system and import the updated compendium Skills/Spells before dropping them. The Starter Set importer updates only attack damage defaults on matching existing Skills/Spells, preserving their other manual edits. Existing owned Attacks are never overwritten; edit them directly to fix their damage. Notes are not parsed for damage at runtime. Additional dice on damage-effect Skills represent only their stated bonus, not a complete parent attack; multipliers, conditions, and Rank upgrades remain manual in Notes/Upgrades. Spell casting still uses the source Spell's mana cost.

Buffs & Debuffs lists display effect description notes beneath each row for all viewers. Notes wrap and preserve line breaks; blank descriptions add no extra row.

## Item modifier targets

On an actor-owned effect or an effect on an owned item, select a DCC Modifier's owned item and aspect in the Changes tab. The chooser writes `item-id:<ID>:<aspect>` into the normal change key; the ID distinguishes duplicate names and continues to work after renaming. Attack targets support To-Hit and Damage; Skill and Spell targets support Rank and Mana Cost. Other keys, including field and group targets, remain editable directly. Legacy `item:<name>:<aspect>` targets continue to affect all matching names.

If a targeted item is deleted or its aspect is invalid, the actor sheet shows the unresolved key. Owned item IDs are scoped to that actor: when copying effects or items to another actor, reselect the target there. Unowned items and compendium effects do not offer the chooser until they belong to an actor; their IDs are not automatically remapped.

## Install

In Foundry's **Game Systems** tab, choose **Install System** and enter this manifest URL:

`https://raw.githubusercontent.com/nextabletop/foundry-dungeon-crawler-carl/main/system.json`

Releases publish an installable ZIP automatically when a version tag matching `system.json` is pushed (for example, `v0.1.0`). The first release must be published before Foundry can download the system.
