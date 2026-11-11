# Dungeon Crawler Carl Foundry VTT system

An official Foundry VTT **v14** game system. System id: `dungeon-crawler-carl`

Actor types: **Crawler** (`pc`), **Mob** (`mob`), and **Vehicle / Mount** (`vehicle`). Item types: weapon, skill, spell, gear.

On Mob sheets, the Combat pencil reveals editable bases while keeping totals visible. Surprise and Evade add Floor, and Move combines effective Move and Step. Mobs with a Spell show a manually editable mana pool; enter current and maximum mana before casting.

For Mob token sizing, include a numbered size such as `Tiny (1)` or `Large (5)` in Descriptors. New tokens use Roll20's size map relative to a 70-pixel grid; the number determines the size. Editing the size updates the prototype for future tokens, but does not resize tokens already on a scene. Without a numbered size, the prototype's dimensions are used.

On Crawler sheets, the Abilities pencil reveals the Unenhanced score inputs. The Combat Edit control reveals Armor, Move Base, Step Base, AI Favor, and Size inputs. Move and Step totals remain visible while editing; Evade can still be rolled from its total.

Mob To-Hit is set per Attack: open the Attack to edit its base or mark it as having no To-Hit. The displayed target applies attack modifiers and adds Floor; new Mob Attacks seed their base from Ability and Rank.

Attack To-Hit and Damage have separate roll buttons. Attacks without damage show plain No Damage text, including alternate uses and vehicle attacks; flat or dice damage modifiers still produce a damage roll.

Skill and Spell rows show effective Rank, check Type, Roll, Used, and Mods. Edit the item to change its details or hotlist membership. Passive entries post their notes with the chat icon; Passive spells still spend mana.

## Item modifier targets

On an actor-owned effect or an effect on an owned item, select a DCC Modifier's owned item and aspect in the Changes tab. The chooser writes `item-id:<ID>:<aspect>` into the normal change key; the ID distinguishes duplicate names and continues to work after renaming. Attack targets support To-Hit and Damage; Skill and Spell targets support Rank and Mana Cost. Other keys, including field and group targets, remain editable directly. Legacy `item:<name>:<aspect>` targets continue to affect all matching names.

If a targeted item is deleted or its aspect is invalid, the actor sheet shows the unresolved key. Owned item IDs are scoped to that actor: when copying effects or items to another actor, reselect the target there. Unowned items and compendium effects do not offer the chooser until they belong to an actor; their IDs are not automatically remapped.

## Install

In Foundry's **Game Systems** tab, choose **Install System** and enter this manifest URL:

`https://raw.githubusercontent.com/nextabletop/foundry-dungeon-crawler-carl/main/system.json`

Releases publish an installable ZIP automatically when a version tag matching `system.json` is pushed (for example, `v0.1.0`). The first release must be published before Foundry can download the system.
