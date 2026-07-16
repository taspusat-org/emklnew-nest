import * as fs from 'fs';
import * as path from 'path';

/**
 * Global CRUD Modules Test Suite
 *
 * This test suite validates that all CRUD modules follow consistent patterns and best practices.
 * It scans all modules in the src/modules directory and checks for:
 * - Service files and their required methods
 * - Controller files and their required endpoints
 * - Module files and their proper configuration
 * - DTO files for input validation
 * - Proper NestJS decorators and patterns
 */

// Configuration: Log file settings
const LOG_DIR = path.join(process.cwd(), 'test-logs');
const LOG_FILE = path.join(LOG_DIR, 'crud-validation.log');

/**
 * Logger utility for writing test results to file
 */
class TestLogger {
  private logs: string[] = [];
  private startTime: Date;

  constructor() {
    this.startTime = new Date();
    this.initializeLogFile();
  }

  private initializeLogFile() {
    // Create log directory if not exists
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }

    // Delete old log file if exists
    if (fs.existsSync(LOG_FILE)) {
      fs.unlinkSync(LOG_FILE);
    }

    // Write header
    this.writeToFile('='.repeat(80));
    this.writeToFile('CRUD MODULES VALIDATION TEST LOG');
    this.writeToFile(`Started: ${this.startTime.toISOString()}`);
    this.writeToFile('='.repeat(80) + '\n');
  }

  private writeToFile(message: string) {
    fs.appendFileSync(LOG_FILE, message + '\n', 'utf-8');
  }

  log(
    message: string,
    level: 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR' = 'INFO',
  ) {
    const timestamp = new Date().toISOString();
    const emoji = {
      INFO: 'ℹ️',
      SUCCESS: '✅',
      WARNING: '⚠️',
      ERROR: '❌',
    }[level];

    const logMessage = `[${timestamp}] ${emoji} ${level}: ${message}`;
    this.logs.push(logMessage);
    this.writeToFile(logMessage);
  }

  logSection(title: string) {
    const separator = '-'.repeat(80);
    this.writeToFile('\n' + separator);
    this.writeToFile(title);
    this.writeToFile(separator + '\n');
  }

  logValidationResult(result: ValidationResult) {
    const level =
      result.status === 'fail'
        ? 'ERROR'
        : result.status === 'warning'
          ? 'WARNING'
          : 'SUCCESS';
    const message = `[${result.module}] [${result.type}] ${result.message}`;

    this.log(message, level);

    if (result.details) {
      this.writeToFile(`  Details: ${JSON.stringify(result.details, null, 2)}`);
    }
  }

  logSummary(summary: any) {
    this.writeToFile('\n' + '='.repeat(80));
    this.writeToFile('VALIDATION SUMMARY');
    this.writeToFile('='.repeat(80));
    this.writeToFile(`Total Modules Scanned: ${summary.totalModules}`);
    this.writeToFile(`Total Validations Run: ${summary.totalValidations}`);
    this.writeToFile(`✅ Passed: ${summary.passed}`);
    this.writeToFile(`❌ Failed: ${summary.failed}`);
    this.writeToFile(`⚠️  Warnings: ${summary.warnings}`);
    this.writeToFile(`Success Rate: ${summary.successRate}%`);
    this.writeToFile('='.repeat(80));

    const endTime = new Date();
    const duration = (endTime.getTime() - this.startTime.getTime()) / 1000;
    this.writeToFile(`\nCompleted: ${endTime.toISOString()}`);
    this.writeToFile(`Duration: ${duration.toFixed(2)} seconds`);
    this.writeToFile(`\nLog file saved at: ${LOG_FILE}`);
  }

  logFailuresByModule(failuresByModule: Record<string, ValidationResult[]>) {
    if (Object.keys(failuresByModule).length > 0) {
      this.writeToFile('\n' + '='.repeat(80));
      this.writeToFile('MODULES WITH FAILURES');
      this.writeToFile('='.repeat(80) + '\n');

      Object.entries(failuresByModule).forEach(([module, failures]) => {
        this.writeToFile(`\n📦 ${module.toUpperCase()}:`);
        failures.forEach((f) => {
          this.writeToFile(`  ❌ [${f.type}] ${f.message}`);
          if (f.details) {
            this.writeToFile(`     Details: ${JSON.stringify(f.details)}`);
          }
        });
      });
    }
  }

  getLogFilePath(): string {
    return LOG_FILE;
  }
}

// Configuration: modules to skip from validation
const SKIP_MODULES = [
  'auth',
  'bot',
  'userrole',
  'user',
  'acos',
  'global',
  'useracl',
  'menu',
  'parameter',
  'STATUSPENDUKUNG',
  'RUNNING-NUMBER',
  'ROLEACL',
  'printer',
  'knex',
  'fieldlength',
  'rabbitmq',
  'rabbitmq-client',
  'sse',
  'error',
  'validator-factory',
  'locks',
  // Non-CRUD utility / detail modules (managed via their header, or not a CRUD
  // entity) — exempt from full create/findAll/update/delete validation.
  'emailvalidation',
  'relasi',
  'panjarmuatandetail',
  'penerimaanemkldetail',
  'pengeluaranemkldetail',
  'pengembaliankasgantungdetail',
];

// Configuration: required CRUD methods
const REQUIRED_SERVICE_METHODS = ['create', 'findAll', 'update', 'delete'];

const OPTIONAL_SERVICE_METHODS = [
  'getById',
  'findOne',
  'exportToExcel',
  'findAllByIds',
];

// Configuration: required controller endpoints
const REQUIRED_CONTROLLER_ENDPOINTS = ['create', 'findAll', 'update', 'delete'];

interface ModuleInfo {
  name: string;
  path: string;
  hasService: boolean;
  hasController: boolean;
  hasModule: boolean;
  serviceFile?: string;
  controllerFile?: string;
  moduleFile?: string;
}

interface ValidationResult {
  module: string;
  type: 'service' | 'controller' | 'module';
  status: 'pass' | 'fail' | 'warning';
  message: string;
  details?: any;
}

/**
 * Scans the modules directory and returns information about each module
 */
function scanModulesDirectory(): ModuleInfo[] {
  const modulesPath = path.join(__dirname);
  const modules: ModuleInfo[] = [];

  const entries = fs.readdirSync(modulesPath, { withFileTypes: true });

  const skipModulesLower = SKIP_MODULES.map((m) => m.toLowerCase());
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    // Case-insensitive: some SKIP_MODULES entries don't match the folder casing.
    if (skipModulesLower.includes(entry.name.toLowerCase())) continue;

    const modulePath = path.join(modulesPath, entry.name);
    const files = fs.readdirSync(modulePath);

    const serviceFile = files.find(
      (f) => f.endsWith('.service.ts') && !f.endsWith('.spec.ts'),
    );
    const controllerFile = files.find(
      (f) => f.endsWith('.controller.ts') && !f.endsWith('.spec.ts'),
    );
    const moduleFile = files.find((f) => f.endsWith('.module.ts'));

    modules.push({
      name: entry.name,
      path: modulePath,
      hasService: !!serviceFile,
      hasController: !!controllerFile,
      hasModule: !!moduleFile,
      serviceFile: serviceFile ? path.join(modulePath, serviceFile) : undefined,
      controllerFile: controllerFile
        ? path.join(modulePath, controllerFile)
        : undefined,
      moduleFile: moduleFile ? path.join(modulePath, moduleFile) : undefined,
    });
  }

  return modules;
}

/**
 * Validates service file for required methods and patterns
 */
function validateServiceFile(moduleInfo: ModuleInfo): ValidationResult[] {
  const results: ValidationResult[] = [];

  if (!moduleInfo.hasService || !moduleInfo.serviceFile) {
    results.push({
      module: moduleInfo.name,
      type: 'service',
      status: 'fail',
      message: 'Service file is missing',
    });
    return results;
  }

  try {
    const content = fs.readFileSync(moduleInfo.serviceFile, 'utf-8');

    // Check for @Injectable decorator
    if (!content.includes('@Injectable()')) {
      results.push({
        module: moduleInfo.name,
        type: 'service',
        status: 'fail',
        message: 'Service must have @Injectable() decorator',
      });
    }

    // Check for required methods
    const missingMethods: string[] = [];
    const foundMethods: string[] = [];

    // Some CRUD methods have accepted synonyms (NestJS scaffolds delete as
    // `remove`). Treat them as equivalent so the convention is honoured.
    const methodSynonyms: Record<string, string[]> = {
      delete: ['delete', 'remove'],
    };

    for (const method of REQUIRED_SERVICE_METHODS) {
      const names = methodSynonyms[method] ?? [method];
      // Check for method declaration with various patterns
      const patterns = names.flatMap((name) => [
        new RegExp(`async\\s+${name}\\s*\\(`),
        new RegExp(`${name}\\s*\\([^)]*\\)\\s*{`),
        new RegExp(`${name}\\s*=\\s*async`),
      ]);

      const hasMethod = patterns.some((pattern) => pattern.test(content));

      if (hasMethod) {
        foundMethods.push(method);
      } else {
        missingMethods.push(method);
      }
    }

    if (missingMethods.length > 0) {
      results.push({
        module: moduleInfo.name,
        type: 'service',
        status: 'fail',
        message: `Missing required methods: ${missingMethods.join(', ')}`,
        details: { missingMethods, foundMethods },
      });
    } else {
      results.push({
        module: moduleInfo.name,
        type: 'service',
        status: 'pass',
        message: `All required methods are present: ${foundMethods.join(', ')}`,
        details: { foundMethods },
      });
    }

    // Check for optional methods (warning only)
    const foundOptionalMethods: string[] = [];
    for (const method of OPTIONAL_SERVICE_METHODS) {
      const patterns = [
        new RegExp(`async\\s+${method}\\s*\\(`),
        new RegExp(`${method}\\s*\\([^)]*\\)\\s*{`),
      ];

      if (patterns.some((pattern) => pattern.test(content))) {
        foundOptionalMethods.push(method);
      }
    }

    if (foundOptionalMethods.length > 0) {
      results.push({
        module: moduleInfo.name,
        type: 'service',
        status: 'pass',
        message: `Optional methods found: ${foundOptionalMethods.join(', ')}`,
        details: { foundOptionalMethods },
      });
    }

    // Check for constructor with proper dependency injection
    if (!content.includes('constructor(')) {
      results.push({
        module: moduleInfo.name,
        type: 'service',
        status: 'warning',
        message: 'Service should have a constructor for dependency injection',
      });
    }

    // Check for tableName property
    if (!content.match(/private\s+readonly\s+tableName\s*=/)) {
      results.push({
        module: moduleInfo.name,
        type: 'service',
        status: 'warning',
        message: 'Service should have a tableName property',
      });
    }

    // Check for proper error handling in methods
    const hasErrorHandling =
      content.includes('try') && content.includes('catch');
    if (!hasErrorHandling) {
      results.push({
        module: moduleInfo.name,
        type: 'service',
        status: 'warning',
        message: 'Service methods should implement try-catch error handling',
      });
    }
  } catch (error) {
    results.push({
      module: moduleInfo.name,
      type: 'service',
      status: 'fail',
      message: `Error reading service file: ${error.message}`,
    });
  }

  return results;
}

/**
 * Validates controller file for required endpoints and patterns
 */
function validateControllerFile(moduleInfo: ModuleInfo): ValidationResult[] {
  const results: ValidationResult[] = [];

  if (!moduleInfo.hasController || !moduleInfo.controllerFile) {
    results.push({
      module: moduleInfo.name,
      type: 'controller',
      status: 'warning',
      message: 'Controller file is missing (optional for some modules)',
    });
    return results;
  }

  try {
    const content = fs.readFileSync(moduleInfo.controllerFile, 'utf-8');

    // Check for @Controller decorator
    if (!content.includes('@Controller(')) {
      results.push({
        module: moduleInfo.name,
        type: 'controller',
        status: 'fail',
        message: 'Controller must have @Controller() decorator',
      });
    }

    // Check for required HTTP method decorators
    const foundEndpoints: string[] = [];
    const missingEndpoints: string[] = [];

    const endpointPatterns = {
      create: /@Post\(/,
      findAll: /@Get\(/,
      update: /@(Put|Patch)\(/,
      delete: /@Delete\(/,
    };

    for (const [endpoint, pattern] of Object.entries(endpointPatterns)) {
      if (pattern.test(content)) {
        foundEndpoints.push(endpoint);
      } else {
        missingEndpoints.push(endpoint);
      }
    }

    if (missingEndpoints.length > 0) {
      results.push({
        module: moduleInfo.name,
        type: 'controller',
        status: 'fail',
        message: `Missing required endpoints: ${missingEndpoints.join(', ')}`,
        details: { missingEndpoints, foundEndpoints },
      });
    } else {
      results.push({
        module: moduleInfo.name,
        type: 'controller',
        status: 'pass',
        message: `All required endpoints are present: ${foundEndpoints.join(', ')}`,
        details: { foundEndpoints },
      });
    }

    // Check for proper dependency injection in constructor
    if (!content.includes('constructor(')) {
      results.push({
        module: moduleInfo.name,
        type: 'controller',
        status: 'warning',
        message: 'Controller should have a constructor for service injection',
      });
    }

    // Check for @UseGuards decorator (security best practice)
    if (!content.includes('@UseGuards(')) {
      results.push({
        module: moduleInfo.name,
        type: 'controller',
        status: 'warning',
        message:
          'Controller should use guards for authentication/authorization',
      });
    }
  } catch (error) {
    results.push({
      module: moduleInfo.name,
      type: 'controller',
      status: 'fail',
      message: `Error reading controller file: ${error.message}`,
    });
  }

  return results;
}

/**
 * Validates module file for proper configuration
 */
function validateModuleFile(moduleInfo: ModuleInfo): ValidationResult[] {
  const results: ValidationResult[] = [];

  if (!moduleInfo.hasModule || !moduleInfo.moduleFile) {
    results.push({
      module: moduleInfo.name,
      type: 'module',
      status: 'fail',
      message: 'Module file is missing',
    });
    return results;
  }

  try {
    const content = fs.readFileSync(moduleInfo.moduleFile, 'utf-8');

    // Check for @Module decorator
    if (!content.includes('@Module(')) {
      results.push({
        module: moduleInfo.name,
        type: 'module',
        status: 'fail',
        message: 'Module must have @Module() decorator',
      });
    }

    // Check for providers array
    if (!content.includes('providers:')) {
      results.push({
        module: moduleInfo.name,
        type: 'module',
        status: 'warning',
        message: 'Module should define providers array',
      });
    }

    // Check for controllers array
    if (moduleInfo.hasController && !content.includes('controllers:')) {
      results.push({
        module: moduleInfo.name,
        type: 'module',
        status: 'warning',
        message:
          'Module should define controllers array when controller exists',
      });
    }

    // Check for exports array (for shared services)
    if (!content.includes('exports:')) {
      results.push({
        module: moduleInfo.name,
        type: 'module',
        status: 'warning',
        message: 'Consider adding exports array if service should be shared',
      });
    }

    results.push({
      module: moduleInfo.name,
      type: 'module',
      status: 'pass',
      message: 'Module configuration is valid',
    });
  } catch (error) {
    results.push({
      module: moduleInfo.name,
      type: 'module',
      status: 'fail',
      message: `Error reading module file: ${error.message}`,
    });
  }

  return results;
}

/**
 * Main test suite
 */
describe('Global CRUD Modules Validation', () => {
  const logger = new TestLogger();
  const modules: ModuleInfo[] = scanModulesDirectory();
  const allResults: ValidationResult[] = [];

  console.log(`\n📦 Found ${modules.length} modules to validate\n`);
  logger.log(`Found ${modules.length} modules to validate`, 'INFO');
  logger.logSection('MODULE STRUCTURE VALIDATION');

  describe('Module Structure Validation', () => {
    it('should have at least one module to validate', () => {
      logger.log(`Validating module count: ${modules.length}`, 'INFO');
      expect(modules.length).toBeGreaterThan(0);
    });

    it('should have service file in each module', () => {
      const modulesWithoutService = modules.filter((m) => !m.hasService);

      if (modulesWithoutService.length > 0) {
        const message = `Modules without service file: ${modulesWithoutService.map((m) => m.name).join(', ')}`;
        console.warn(`⚠️  ${message}`);
        logger.log(message, 'WARNING');
      } else {
        logger.log('All modules have service files', 'SUCCESS');
      }

      expect(modulesWithoutService.length).toBeLessThanOrEqual(
        modules.length * 0.1,
      ); // Allow 10% without service
    });

    it('should have module file in each module', () => {
      const modulesWithoutModule = modules.filter((m) => !m.hasModule);

      if (modulesWithoutModule.length > 0) {
        const message = `Modules without module file: ${modulesWithoutModule.map((m) => m.name).join(', ')}`;
        console.warn(`⚠️  ${message}`);
        logger.log(message, 'ERROR');
      } else {
        logger.log('All modules have module files', 'SUCCESS');
      }

      expect(modulesWithoutModule.length).toBe(0);
    });
  });

  describe('Service Files Validation', () => {
    logger.logSection('SERVICE FILES VALIDATION');

    if (modules && modules.length > 0) {
      modules.forEach((moduleInfo) => {
        if (!moduleInfo.hasService) return;

        describe(`${moduleInfo.name} Service`, () => {
          let results: ValidationResult[];

          beforeAll(() => {
            results = validateServiceFile(moduleInfo);
            allResults.push(...results);

            // Log all results for this module
            results.forEach((r) => logger.logValidationResult(r));
          });

          it('should have valid service structure', () => {
            const failures = results.filter((r) => r.status === 'fail');

            if (failures.length > 0) {
              failures.forEach((f) => {
                console.error(`❌ ${f.module} - ${f.message}`);
                if (f.details) {
                  console.error(`   Details:`, f.details);
                }
              });
            }

            expect(failures.length).toBe(0);
          });

          it('should have all required CRUD methods', () => {
            const methodResult = results.find((r) =>
              r.message.includes('required methods'),
            );

            if (methodResult && methodResult.status === 'fail') {
              console.error(`❌ ${moduleInfo.name} - ${methodResult.message}`);
              console.error(`   Details:`, methodResult.details);
            }

            expect(methodResult?.status).not.toBe('fail');
          });

          it('should follow best practices', () => {
            const warnings = results.filter((r) => r.status === 'warning');

            if (warnings.length > 0) {
              warnings.forEach((w) => {
                console.warn(`⚠️  ${w.module} - ${w.message}`);
              });
            }

            // Warnings don't fail the test, but we want to see them
            expect(warnings.length).toBeLessThanOrEqual(3); // Allow up to 3 warnings
          });
        });
      });
    }
  });

  describe('Controller Files Validation', () => {
    logger.logSection('CONTROLLER FILES VALIDATION');

    if (modules && modules.length > 0) {
      modules.forEach((moduleInfo) => {
        if (!moduleInfo.hasController) return;

        describe(`${moduleInfo.name} Controller`, () => {
          let results: ValidationResult[];

          beforeAll(() => {
            results = validateControllerFile(moduleInfo);
            allResults.push(...results);

            // Log all results for this module
            results.forEach((r) => logger.logValidationResult(r));
          });

          it('should have valid controller structure', () => {
            const failures = results.filter((r) => r.status === 'fail');

            if (failures.length > 0) {
              failures.forEach((f) => {
                console.error(`❌ ${f.module} - ${f.message}`);
              });
            }

            expect(failures.length).toBe(0);
          });

          it('should have all required HTTP endpoints', () => {
            const endpointResult = results.find((r) =>
              r.message.includes('required endpoints'),
            );

            if (endpointResult && endpointResult.status === 'fail') {
              console.error(
                `❌ ${moduleInfo.name} - ${endpointResult.message}`,
              );
              console.error(`   Details:`, endpointResult.details);
            }

            expect(endpointResult?.status).not.toBe('fail');
          });
        });
      });
    }
  });

  describe('Module Files Validation', () => {
    logger.logSection('MODULE FILES VALIDATION');

    if (modules && modules.length > 0) {
      modules.forEach((moduleInfo) => {
        describe(`${moduleInfo.name} Module`, () => {
          let results: ValidationResult[];

          beforeAll(() => {
            results = validateModuleFile(moduleInfo);
            allResults.push(...results);

            // Log all results for this module
            results.forEach((r) => logger.logValidationResult(r));
          });

          it('should have valid module configuration', () => {
            const failures = results.filter((r) => r.status === 'fail');

            if (failures.length > 0) {
              failures.forEach((f) => {
                console.error(`❌ ${f.module} - ${f.message}`);
              });
            }

            expect(failures.length).toBe(0);
          });
        });
      });
    }
  });

  describe('Overall Statistics', () => {
    it('should generate validation summary', () => {
      const summary = {
        totalModules: modules.length,
        totalValidations: allResults.length,
        passed: allResults.filter((r) => r.status === 'pass').length,
        failed: allResults.filter((r) => r.status === 'fail').length,
        warnings: allResults.filter((r) => r.status === 'warning').length,
        successRate: 0,
      };

      summary.successRate =
        summary.totalValidations > 0
          ? Math.round((summary.passed / summary.totalValidations) * 100)
          : 0;

      console.log('\n' + '='.repeat(60));
      console.log('📊 VALIDATION SUMMARY');
      console.log('='.repeat(60));
      console.log(`Total Modules Scanned: ${summary.totalModules}`);
      console.log(`Total Validations Run: ${summary.totalValidations}`);
      console.log(`✅ Passed: ${summary.passed}`);
      console.log(`❌ Failed: ${summary.failed}`);
      console.log(`⚠️  Warnings: ${summary.warnings}`);
      console.log('='.repeat(60) + '\n');

      // Group failures by module
      const failuresByModule = allResults
        .filter((r) => r.status === 'fail')
        .reduce(
          (acc, r) => {
            if (!acc[r.module]) acc[r.module] = [];
            acc[r.module].push(r);
            return acc;
          },
          {} as Record<string, ValidationResult[]>,
        );

      if (Object.keys(failuresByModule).length > 0) {
        console.log('❌ MODULES WITH FAILURES:\n');
        Object.entries(failuresByModule).forEach(([module, failures]) => {
          console.log(`  ${module}:`);
          failures.forEach((f) => {
            console.log(`    - [${f.type}] ${f.message}`);
          });
          console.log('');
        });
      }

      // Write summary to log file
      logger.logFailuresByModule(failuresByModule);
      logger.logSummary(summary);

      // Print log file location
      console.log(`\n📝 Detailed log saved to: ${logger.getLogFilePath()}\n`);

      expect(summary.failed).toBeLessThanOrEqual(
        summary.totalValidations * 0.05,
      ); // Allow max 5% failure rate
    });
  });
});
