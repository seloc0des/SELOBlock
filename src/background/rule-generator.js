export class RuleGenerator {
  constructor() {
    this.ruleIdCounter = 1;
  }

  generateRules(domains) {
    this.ruleIdCounter = 1;
    const rules = [];

    for (const domain of domains) {
      const rule = this.createBlockRule(domain);
      if (rule) {
        rules.push(rule);
      }
    }

    return rules;
  }

  createBlockRule(domain) {
    return {
      id: this.ruleIdCounter++,
      priority: 1,
      action: {
        type: 'block'
      },
      condition: {
        urlFilter: `||${domain}^`,
        resourceTypes: [
          'main_frame',
          'sub_frame',
          'stylesheet',
          'script',
          'image',
          'font',
          'object',
          'xmlhttprequest',
          'ping',
          'media',
          'websocket',
          'webtransport',
          'webbundle',
          'other'
        ]
      }
    };
  }

  createAllowRule(domain) {
    return {
      id: this.ruleIdCounter++,
      priority: 2,
      action: {
        type: 'allow'
      },
      condition: {
        urlFilter: `||${domain}^`,
        resourceTypes: [
          'main_frame',
          'sub_frame',
          'stylesheet',
          'script',
          'image',
          'font',
          'object',
          'xmlhttprequest',
          'ping',
          'media',
          'websocket',
          'webtransport',
          'webbundle',
          'other'
        ]
      }
    };
  }
}
