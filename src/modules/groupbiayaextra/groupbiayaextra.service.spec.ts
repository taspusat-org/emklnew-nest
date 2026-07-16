import { Test, TestingModule } from '@nestjs/testing';
import { autoMocker } from 'src/test/automock';
import { GroupbiayaextraService } from './groupbiayaextra.service';

describe('GroupbiayaextraService', () => {
  let service: GroupbiayaextraService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [GroupbiayaextraService],
    }).useMocker(autoMocker).compile();

    service = module.get<GroupbiayaextraService>(GroupbiayaextraService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
