import { ComponentFixture, TestBed } from '@angular/core/testing';

import { BottomNav } from './bottom-nav';

describe('BottomNav', () => {
  let component: BottomNav;
  let fixture: ComponentFixture<BottomNav>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BottomNav],
    }).compileComponents();

    fixture = TestBed.createComponent(BottomNav);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
