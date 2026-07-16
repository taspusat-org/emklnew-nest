/**
 * CRUD Modules Validation Configuration
 *
 * This file contains the configuration for the global CRUD modules validation test.
 * You can customize the validation rules, skip modules, and define expectations here.
 */

export interface CrudValidationConfig {
  // Modules to skip from validation
  skipModules: string[];

  // Required methods in service files
  requiredServiceMethods: string[];

  // Optional methods in service files (will show as warnings if missing)
  optionalServiceMethods: string[];

  // Required HTTP endpoints in controller files
  requiredControllerEndpoints: string[];

  // Validation thresholds
  thresholds: {
    maxWarningsPerModule: number;
    maxFailureRate: number; // 0-1 (e.g., 0.05 = 5%)
    minModulesWithService: number; // 0-1 (e.g., 0.9 = 90%)
  };

  // Feature flags for specific validations
  features: {
    checkErrorHandling: boolean;
    checkGuards: boolean;
    checkTableName: boolean;
    checkExports: boolean;
    checkDependencyInjection: boolean;
  };
}

export const defaultConfig: CrudValidationConfig = {
  skipModules: [
    'auth',
    'bot',
    'global',
    'knex',
    'rabbitmq',
    'rabbitmq-client',
    'sse',
    'error',
    'validator-factory',
    'locks',
  ],

  requiredServiceMethods: ['create', 'findAll', 'update', 'delete'],

  optionalServiceMethods: [
    'getById',
    'findOne',
    'exportToExcel',
    'findAllByIds',
  ],

  requiredControllerEndpoints: ['create', 'findAll', 'update', 'delete'],

  thresholds: {
    maxWarningsPerModule: 3,
    maxFailureRate: 0.05, // 5%
    minModulesWithService: 0.9, // 90%
  },

  features: {
    checkErrorHandling: true,
    checkGuards: true,
    checkTableName: true,
    checkExports: false, // Set to true if you want to enforce exports
    checkDependencyInjection: true,
  },
};

/**
 * Custom validation rules for specific modules
 * Use this to override default rules for specific modules
 */
export const moduleSpecificRules: Record<
  string,
  Partial<CrudValidationConfig>
> = {
  // Example: parameter module might need different rules
  parameter: {
    requiredServiceMethods: [
      'create',
      'findAll',
      'update',
      'delete',
      'getComboData',
    ],
  },

  // Example: running-number might not need all CRUD methods
  'running-number': {
    requiredServiceMethods: ['getNextNumber', 'findAll'],
  },
};

/**
 * Expected response structure for CRUD operations
 */
export interface CrudResponseExpectations {
  create: {
    shouldReturn: string[]; // e.g., ['newItem', 'pageNumber', 'itemIndex', 'fetchedPages']
  };
  findAll: {
    shouldReturn: string[]; // e.g., ['data', 'pagination', 'total']
  };
  update: {
    shouldReturn: string[]; // e.g., ['updatedItem', 'pageNumber', 'itemIndex', 'fetchedPages']
  };
  delete: {
    shouldReturn: string[]; // e.g., ['status', 'message', 'deletedData']
  };
}

export const expectedResponses: CrudResponseExpectations = {
  create: {
    shouldReturn: ['newItem', 'pageNumber', 'itemIndex', 'fetchedPages'],
  },
  findAll: {
    shouldReturn: ['data', 'pagination', 'total'],
  },
  update: {
    shouldReturn: ['updatedItem', 'pageNumber', 'itemIndex', 'fetchedPages'],
  },
  delete: {
    shouldReturn: ['status', 'message', 'deletedData'],
  },
};
