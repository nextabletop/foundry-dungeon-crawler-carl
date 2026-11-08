/**
 * Modifier / buff editor: core's ActiveEffectConfig (parts, tabs and markup
 * unchanged) with the DCC classes, so system.css can dress it in the sheet
 * style (tokens, paper, bars, tab strip, the changes table).
 */
export default class DCCActiveEffectConfig extends foundry.applications.sheets.ActiveEffectConfig {
  static DEFAULT_OPTIONS = {
    classes: ['dcc', 'effect'],
  };
}
