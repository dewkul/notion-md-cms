import { Client } from "@notionhq/client/build/src";
import { Page } from "@notionhq/client/build/src/api-types";

import { SyncConfig } from "./";
import { lookupDatabaseConfig } from "./config";
import { Database } from "./Database";
import { DatabaseViewRenderer } from "./DatabaseViewRenderer";
import { DeferredRenderer } from "./DeferredRenderer";
import { RenderDatabasePageTask } from "./RenderDatabasePageTask";
import { DatabaseConfig, DatabaseConfigRenderPages, DatabaseConfigRenderTable } from "./SyncConfig";
import { DatabaseTableRenderer } from "./DatabaseTableRenderer";

export class ChildDatabaseRenderer {
  constructor(
    private readonly config: SyncConfig,
    private readonly publicApi: Client,
    private readonly deferredRenderer: DeferredRenderer,
    private readonly tableRenderer: DatabaseTableRenderer,
    private readonly viewRenderer: DatabaseViewRenderer
  ) {}

  async renderChildDatabase(databaseId: string): Promise<Database> {
    const dbConfig = lookupDatabaseConfig(this.config, databaseId);

    // no view was defined for this database, render as a plain inline table
    const allPages = await this.fetchPages(databaseId, dbConfig);

    const isCmsDb = this.config.cmsDatabaseId === databaseId;
    const renderPages = isCmsDb || dbConfig.renderAs === "pages+views"

    if (renderPages) {
      const pageConfig = dbConfig as DatabaseConfigRenderPages;
      const entries = await this.queuePageRendering(allPages, pageConfig);
      const markdown = await this.viewRenderer.renderViews(entries, dbConfig as DatabaseConfigRenderPages);

      return {
        config: dbConfig,
        entries,
        markdown,
      };
    }

    const entries = await this.queueEntryRendering(allPages, dbConfig);
    const markdown = this.tableRenderer.renderTable(entries);

    return {
      config: dbConfig,
      entries,
      markdown,
    };
  }

  private async queueEntryRendering(
    allPages: Page[],
    dbConfig: DatabaseConfigRenderTable
  ) {
    const prepareRenderEntryTasks = allPages.map((x) =>
      this.deferredRenderer.renderEntry(x, dbConfig)
    );

    // note: the await here is not actually starting to render the pages, however it prepares the page render task
    return await Promise.all(prepareRenderEntryTasks);
  }

  private async queuePageRendering(
    allPages: Page[],
    dbConfig: DatabaseConfigRenderPages
  ): Promise<RenderDatabasePageTask[]> {
    const prepareRenderPageTasks = allPages.map((x) =>
      this.deferredRenderer.renderPage(x, dbConfig)
    );

    // note: the await here is not actually starting to render the pages, however it prepares the page render task
    return await Promise.all(prepareRenderPageTasks);
  }

  private async fetchPages(
    databaseId: string,
    dbConfig: DatabaseConfig
  ): Promise<Page[]> {
    const db = await this.publicApi.databases.retrieve({
      database_id: databaseId,
    });

    const allPages = await this.publicApi.databases.query({
      database_id: db.id,
      sorts: dbConfig.sorts,
      page_size: 100,
    }); // todo: paging

    if (allPages.next_cursor) {
      throw new Error(
        `Paging not implemented, db ${db.id} has more than 100 entries`
      );
    }

    return allPages.results;
  }
}