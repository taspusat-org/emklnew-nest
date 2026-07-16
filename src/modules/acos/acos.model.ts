import * as fs from 'fs';
import * as path from 'path';
import * as glob from 'glob';
import { dbMssql } from 'src/common/utils/db';
import { CreateAcosDto } from './dto/create-aco.dto';

export class AcosModel {
  static async syncAcos(username: string) {
    const acosEntries: CreateAcosDto[] = [];

    // BAGIAN 1: Scanning from file controller (existing code)
    const controllersPath = 'src/modules/**/*.controller.ts';
    const files = glob.sync(controllersPath);

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf-8');
      const regex =
        /@(Get|Post|Put|Delete|Patch)\([^)]*\)[\s\S]*?\/\/@([\w\- ]+)/g;
      let match;
      while ((match = regex.exec(content)) !== null) {
        const httpMethod = match[1].toUpperCase(); // HTTP method (GET, POST, etc.)
        const className = match[2]?.trim(); // Extract class name

        if (httpMethod && className) {
          acosEntries.push({
            class: className,
            method: httpMethod,
            nama: `${className}->${httpMethod}`,
            modifiedby: username,
          });
        }
      }
    }
    // BAGIAN 2: Generate from parameter table (YA and TIDAK)
    try {
      const parameterEntries = await dbMssql('parameter')
        .select('subgrp', 'text')
        .where('grp', 'DATA PENDUKUNG')
        .whereNotNull('subgrp')
        .whereNotNull('text')
        .andWhere('subgrp', '!=', '')
        .andWhere('text', '!=', '');

      const parameterDataLainnyaEntries = await dbMssql('parameter')
        .select('grp', 'subgrp', 'text')
        .where('grp', 'DATA LAINNYA')
        .whereNotNull('subgrp')
        .whereNotNull('text')
        .andWhere('subgrp', '!=', '')
        .andWhere('text', '!=', '');

      const parameterDataStatusJob = await dbMssql('parameter')
        .select('grp', 'subgrp', 'text')
        .where('grp', 'DATA STATUS JOB')
        .whereNotNull('subgrp')
        .whereNotNull('text')
        .andWhere('subgrp', '!=', '')
        .andWhere('text', '!=', '');

      for (const param of parameterEntries) {
        if (param.subgrp && param.text) {
          const classValue = param.subgrp.trim();
          const baseMethodValue = param.text.trim();
          const suffixes = ['YA', 'TIDAK'];

          // Generate 2 entries for each parameter (YA and TIDAK)
          for (const suffix of suffixes) {
            const methodValue = `${baseMethodValue} -> ${suffix}`;
            acosEntries.push({
              class: classValue,
              method: methodValue,
              nama: `${classValue}->${methodValue}`,
              modifiedby: username,
            });
          }
        }
      }

      for (const params of parameterDataLainnyaEntries) {
        if (params.subgrp && params.text) {
          const classValue = params.subgrp.trim();
          const baseMethodValue = params.text.trim();
          const grpValue = params.grp.trim();
          const suffixes = ['YA'];

          // Generate 2 entries for each parameter (YA)
          for (const suffix of suffixes) {
            const methodValue = `${baseMethodValue} -> ${grpValue} -> ${suffix}`;
            acosEntries.push({
              class: classValue,
              method: methodValue,
              nama: `${classValue}->${methodValue}`,
              modifiedby: username,
            });
          }
        }
      }

      for (const param of parameterDataStatusJob) {
        if (param.subgrp && param.text) {
          const classValue = param.subgrp.trim();
          const baseMethodValue = param.text.trim();
          const suffixes = ['YA', 'TIDAK'];

          // Generate 2 entries for each parameter (YA and TIDAK)
          for (const suffix of suffixes) {
            const methodValue = `${baseMethodValue} -> ${suffix}`;
            acosEntries.push({
              class: classValue,
              method: methodValue,
              nama: `${classValue}->${methodValue}`,
              modifiedby: username,
            });
          }
        }
      }
    } catch (error) {
      console.error('Error fetching parameter data:', error);
    }

    if (acosEntries.length === 0) {
      return { success: false, message: 'No ACOS entries found.' };
    }

    // Remove duplicates based on class and method
    const uniqueAcosEntries = acosEntries.filter(
      (value, index, self) =>
        index ===
        self.findIndex(
          (t) => t.class === value.class && t.method === value.method,
        ),
    );

    try {
      // Generate OR conditions for each class-method pair
      const conditions = uniqueAcosEntries
        .map(
          (entry) =>
            `([class] = '${entry.class}' AND [method] = '${entry.method}')`,
        )
        .join(' OR ');

      // Query existing entries in the 'acos' table
      const existingEntries = await dbMssql('acos')
        .select('class', 'method')
        .whereRaw(conditions);

      // Create a set of existing class-method pairs for fast lookup
      const existingSet = new Set(
        existingEntries.map((entry) => `${entry.class}->${entry.method}`),
      );

      // Filter out entries that already exist
      const newEntries = uniqueAcosEntries.filter(
        (entry) => !existingSet.has(`${entry.class}->${entry.method}`),
      );

      // Insert new entries if there are any
      if (newEntries.length > 0) {
        const result = await dbMssql('acos').insert(newEntries).returning('*');

        // Log summary of the sync process
        const controllerCount = newEntries.filter((e) =>
          ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].includes(e.method),
        ).length;

        const parameterCount = newEntries.filter((e) =>
          e.method.includes('->'),
        ).length;

        return {
          success: true,
          data: result,
          summary: {
            totalNewEntries: newEntries.length,
            fromControllers: controllerCount,
            fromParameters: parameterCount,
            parameterYA: newEntries.filter((e) => e.method.includes('-> YA'))
              .length,
            parameterTIDAK: newEntries.filter((e) =>
              e.method.includes('-> TIDAK'),
            ).length,
          },
        };
      } else {
        return { success: true, message: 'No new ACOS entries to sync.' };
      }
    } catch (error) {
      console.error('Error syncing ACOS:', error);
      return { success: false, message: 'Failed to sync ACOS data.', error };
    }
  }
}
