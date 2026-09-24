import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ModelForm } from "../model-form";
import { createModel } from "../actions";

export default function NewModelPage() {
  return (
    <div className="max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>Новая модель изделия</CardTitle>
        </CardHeader>
        <CardContent>
          <ModelForm action={createModel} />
        </CardContent>
      </Card>
    </div>
  );
}
