'use client';

import { useState, useEffect } from 'react';
import { getFloors, createFloor, updateFloor, deleteFloor } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';

type Floor = {
  id: string;
  name: string;
  price_multiplier: number;
};

export default function FloorsManager({ restaurantId }: { restaurantId: string }) {
  const [floors, setFloors] = useState<Floor[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingFloor, setEditingFloor] = useState<Floor | null>(null);
  const [formData, setFormData] = useState({ name: '', price_multiplier: 1.0 });
  const [loading, setLoading] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);

  useEffect(() => {
    fetchFloors();
  }, [restaurantId]);

  async function fetchFloors() {
    const data = await getFloors(restaurantId);
    setFloors(data);
    setPageLoading(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    try {
      if (editingFloor) {
        await updateFloor(editingFloor.id, {
          name: formData.name,
          price_multiplier: formData.price_multiplier
        }, restaurantId);
      } else {
        await createFloor({
          restaurantId,
          name: formData.name,
          priceMultiplier: formData.price_multiplier
        });
      }

      setIsDialogOpen(false);
      setEditingFloor(null);
      setFormData({ name: '', price_multiplier: 1.0 });
      fetchFloors();
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(floorId: string) {
    if (!confirm('Delete this floor? Tables will be unassigned from this floor.')) return;
    try {
      await deleteFloor(floorId, restaurantId);
    } catch {
      alert('Failed to delete floor. Make sure all tables are unassigned first.');
      return;
    }
    fetchFloors();
  }

  function openDialog(floor?: Floor) {
    if (floor) {
      setEditingFloor(floor);
      setFormData({ name: floor.name, price_multiplier: floor.price_multiplier });
    } else {
      setEditingFloor(null);
      setFormData({ name: '', price_multiplier: 1.0 });
    }
    setIsDialogOpen(true);
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-lg font-semibold">Floors & Sections</h2>
          <p className="text-sm text-muted-foreground">
            Manage different floors/sections with custom pricing
          </p>
        </div>
        <Button onClick={() => openDialog()}>Add Floor</Button>
      </div>

      {pageLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : floors.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-muted-foreground">No floors created yet</p>
          <Button className="mt-4" onClick={() => openDialog()}>
            Create First Floor
          </Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {floors.map((floor) => (
            <Card key={floor.id} className="p-6">
              <h3 className="font-semibold text-lg">{floor.name}</h3>
              <div className="mt-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Multiplier:</span>
                  <span className="font-medium">{floor.price_multiplier}x</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Premium:</span>
                  <span className="font-medium">
                    {floor.price_multiplier === 1.0
                      ? 'Normal pricing'
                      : `+${((floor.price_multiplier - 1) * 100).toFixed(0)}%`}
                  </span>
                </div>
              </div>
              <div className="flex gap-2 mt-6">
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  onClick={() => openDialog(floor)}
                >
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  className="flex-1"
                  onClick={() => handleDelete(floor.id)}
                >
                  Delete
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingFloor ? 'Edit Floor' : 'Add Floor'}</DialogTitle>
            <DialogDescription>
              {editingFloor ? 'Update floor details and pricing multiplier' : 'Create a new floor with custom pricing'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="name">Floor Name</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., AC Hall, Rooftop, Ground Floor"
                required
              />
            </div>
            <div>
              <Label htmlFor="multiplier">Price Multiplier</Label>
              <Input
                id="multiplier"
                type="number"
                step="0.1"
                min="0.1"
                max="10"
                value={formData.price_multiplier}
                onChange={(e) =>
                  setFormData({ ...formData, price_multiplier: parseFloat(e.target.value) })
                }
                required
              />
              <p className="text-xs text-muted-foreground mt-1">
                1.0 = normal price, 1.2 = 20% premium, 1.5 = 50% premium
              </p>
              {formData.price_multiplier !== 1.0 && !isNaN(formData.price_multiplier) && (
                <p className="text-xs text-primary mt-1 font-medium">
                  e.g. ₹100 item → ₹{(100 * formData.price_multiplier).toFixed(0)} on this floor
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={loading}>
                {loading ? 'Saving...' : 'Save'}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsDialogOpen(false)}
                disabled={loading}
              >
                Cancel
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
