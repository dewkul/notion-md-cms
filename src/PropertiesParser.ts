import { Page, PropertyValue } from '@notionhq/client/build/src/api-types';

import { logger } from './logger';
import { PageProperties } from './PageProperties';
import { RichTextRenderer } from './RichTextRenderer';
import { slugify } from './slugify';
import { DatabaseConfig } from './SyncConfig';

const debug = require("debug")("properties");

export interface ParsedProperties {
  title: string | null;
  category: string | null;
  order: number | undefined;
  properties: Record<string, any>;
  keys: Map<string, string>;
}

export class PropertiesParser {
  constructor(private readonly richText: RichTextRenderer) {}

  public async parsePageProperties(
    page: Page,
    config: DatabaseConfig,
  ): Promise<PageProperties> {
    const { title, category, order, properties, keys } = await this
      .parseProperties(page, config);

    if (!title) {
      throw this.errorMissingRequiredProperty("of type 'title'", page);
    }

    if (!category) {
      throw this.errorMissingRequiredProperty(config.properties.category, page);
    }

    return {
      meta: {
        id: page.id,
        url: page.url,
        title: title, // notion API always calls it name
        category: category,
        order: order,
        ...config.additionalPageFrontmatter,
      },
      values: properties,
      keys: keys,
    };
  }

 public async parseProperties(page: Page, config: DatabaseConfig) {
    const properties: Record<string, any> = {};
    const keys = new Map<string, string>();

    let title: string | null = null;
    let category: string | null = null;
    let order: number | undefined = undefined;

    for (const [name, value] of Object.entries(page.properties)) {
      const parsedValue = await this.parsePropertyValue(value);

      if (
        !config.properties.include ||
        config.properties.include.indexOf(name) >= 0
      ) {
        const slug = slugify(name);
        properties[slug] = parsedValue;
        keys.set(name, slug);
      }

      if (value.type === "title") {
        title = parsedValue;
      }

      if (name === config.properties.category) {
        category = parsedValue;
      }

      if (name === "order") {
        order = parsedValue;
      }
    }
    return {
      title,
      category,
      order,
      properties,
      keys: PropertiesParser.filterIncludedKeys(
        config.properties.include,
        keys,
      ),
    };
  }

  private async parsePropertyValue(value: PropertyValue): Promise<any> {
    switch (value.type) {
      case "number":
        return value.number;
      case "title":
        return await this.richText.renderMarkdown(value.title);
      case "rich_text":
        return await this.richText.renderMarkdown(value.rich_text);
      case "select":
        return value.select?.name;
      case "multi_select":
        return value.multi_select.map((x) => x.name);
      case "date":
        return value.date;
      case "relation":
        return value.relation.map((x) => x.id);
      case "url":
        return value.url;
      case "email":
        return value.email;
      case "phone_number":
        return value.phone_number;
      case "created_time":
        return value.created_time;
      case "created_by":
        return value.created_by.name;
      case "last_edited_time":
        return value.last_edited_time;
      case "last_edited_by":
        return value.last_edited_by.name;
      case "formula":
      case "rollup":
      case "people":
      case "files":
      case "checkbox":
        const notSupported = "unsupported property type: " + value.type;
        logger.warn(notSupported);
        debug(notSupported + "\n%O", value);

        return notSupported;
    }
  }

  public static filterIncludedKeys(
    includes: string[] | undefined,
    keys: Map<string, string>,
  ): Map<string, string> {
    if (!includes) {
      return keys;
    }

    // Maps iterate in insertion order, so preserve the correct ordering of keys according to includes ordering
    const filtered = new Map<string, string>();
    includes.forEach((i) => filtered.set(i, keys.get(i)!!)); // todo: should probably handle undefined here

    return filtered;
  }

  private errorMissingRequiredProperty(propertyName: string, page: Page) {
    const msg = `Page ${page.url} is missing required property ${propertyName}`;
    debug(msg + "\n%O", page);

    return new Error(msg);
  }
}
