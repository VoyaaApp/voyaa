import { Component, ChangeDetectionStrategy } from '@angular/core';
import { Location } from '@angular/common';
import { inject } from '@angular/core';

@Component({
  selector: 'app-terms',
  templateUrl: './terms.html',
  styleUrl: './terms.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Terms {
  private location = inject(Location);

  goBack() {
    this.location.back();
  }
}
