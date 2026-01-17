import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { UserCheck, Brain, CheckCircle, XCircle, ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

interface HumanReviewModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: { humanReviewed: boolean; decision?: "valid" | "faulty"; remarks?: string }) => void;
  isLoading?: boolean;
}

export function HumanReviewModal({ open, onClose, onSubmit, isLoading }: HumanReviewModalProps) {
  const [step, setStep] = useState<"question" | "decision">("question");
  const [humanReviewed, setHumanReviewed] = useState<"yes" | "no" | null>(null);
  const [decision, setDecision] = useState<"valid" | "faulty" | null>(null);
  const [remarks, setRemarks] = useState("");

  const handleContinue = () => {
    if (humanReviewed === "yes") {
      setStep("decision");
    } else if (humanReviewed === "no") {
      onSubmit({ humanReviewed: false });
      resetAndClose();
    }
  };

  const handleSubmitDecision = () => {
    if (decision) {
      onSubmit({
        humanReviewed: true,
        decision,
        remarks: remarks.trim() || undefined,
      });
      resetAndClose();
    }
  };

  const resetAndClose = () => {
    setStep("question");
    setHumanReviewed(null);
    setDecision(null);
    setRemarks("");
  };

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      resetAndClose();
      onClose();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="dialog-human-review">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserCheck className="h-5 w-5 text-primary" />
            Human Review Status
          </DialogTitle>
          <DialogDescription>
            {step === "question"
              ? "Before AI analysis, please confirm the review status of this evidence."
              : "What was the human officer's decision on this evidence?"}
          </DialogDescription>
        </DialogHeader>

        {step === "question" && (
          <div className="space-y-4 py-4">
            <p className="text-sm font-medium">
              Has this evidence already been checked by a human officer?
            </p>
            <RadioGroup
              value={humanReviewed || ""}
              onValueChange={(value) => setHumanReviewed(value as "yes" | "no")}
              className="space-y-3"
            >
              <Card className={`cursor-pointer transition-colors ${humanReviewed === "yes" ? "border-primary bg-primary/5" : "hover-elevate"}`}>
                <CardContent className="p-4">
                  <div className="flex items-center space-x-3">
                    <RadioGroupItem value="yes" id="human-yes" data-testid="radio-human-yes" />
                    <Label htmlFor="human-yes" className="flex-1 cursor-pointer">
                      <div className="flex items-center gap-2">
                        <UserCheck className="h-4 w-4 text-green-600" />
                        <span className="font-medium">Yes - Human already reviewed</span>
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">
                        AI will validate the human decision only
                      </p>
                    </Label>
                  </div>
                </CardContent>
              </Card>

              <Card className={`cursor-pointer transition-colors ${humanReviewed === "no" ? "border-primary bg-primary/5" : "hover-elevate"}`}>
                <CardContent className="p-4">
                  <div className="flex items-center space-x-3">
                    <RadioGroupItem value="no" id="human-no" data-testid="radio-human-no" />
                    <Label htmlFor="human-no" className="flex-1 cursor-pointer">
                      <div className="flex items-center gap-2">
                        <Brain className="h-4 w-4 text-blue-600" />
                        <span className="font-medium">No - AI should analyse now</span>
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">
                        AI will perform full analysis from scratch
                      </p>
                    </Label>
                  </div>
                </CardContent>
              </Card>
            </RadioGroup>
          </div>
        )}

        {step === "decision" && (
          <div className="space-y-4 py-4">
            <p className="text-sm font-medium">What was the human decision?</p>
            <RadioGroup
              value={decision || ""}
              onValueChange={(value) => setDecision(value as "valid" | "faulty")}
              className="space-y-3"
            >
              <Card className={`cursor-pointer transition-colors ${decision === "valid" ? "border-green-500 bg-green-50 dark:bg-green-900/10" : "hover-elevate"}`}>
                <CardContent className="p-4">
                  <div className="flex items-center space-x-3">
                    <RadioGroupItem value="valid" id="decision-valid" data-testid="radio-decision-valid" />
                    <Label htmlFor="decision-valid" className="flex-1 cursor-pointer">
                      <div className="flex items-center gap-2">
                        <CheckCircle className="h-4 w-4 text-green-600" />
                        <span className="font-medium">Evidence Correct (PCN allowed)</span>
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">
                        Human confirmed evidence is valid for enforcement
                      </p>
                    </Label>
                  </div>
                </CardContent>
              </Card>

              <Card className={`cursor-pointer transition-colors ${decision === "faulty" ? "border-destructive bg-destructive/5" : "hover-elevate"}`}>
                <CardContent className="p-4">
                  <div className="flex items-center space-x-3">
                    <RadioGroupItem value="faulty" id="decision-faulty" data-testid="radio-decision-faulty" />
                    <Label htmlFor="decision-faulty" className="flex-1 cursor-pointer">
                      <div className="flex items-center gap-2">
                        <XCircle className="h-4 w-4 text-destructive" />
                        <span className="font-medium">Evidence Faulty (PCN blocked)</span>
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">
                        Human found issues with the evidence
                      </p>
                    </Label>
                  </div>
                </CardContent>
              </Card>
            </RadioGroup>

            <div className="space-y-2">
              <Label htmlFor="remarks">Human remarks (optional)</Label>
              <Textarea
                id="remarks"
                placeholder="Any notes from the human review..."
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                className="resize-none"
                rows={3}
                data-testid="input-remarks"
              />
            </div>
          </div>
        )}

        <DialogFooter>
          {step === "question" ? (
            <Button
              onClick={handleContinue}
              disabled={!humanReviewed || isLoading}
              data-testid="button-continue"
            >
              Continue
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          ) : (
            <div className="flex gap-2 w-full">
              <Button
                variant="outline"
                onClick={() => setStep("question")}
                disabled={isLoading}
                data-testid="button-back"
              >
                Back
              </Button>
              <Button
                onClick={handleSubmitDecision}
                disabled={!decision || isLoading}
                className="flex-1"
                data-testid="button-submit-decision"
              >
                {isLoading ? "Processing..." : "Confirm & Start AI Analysis"}
              </Button>
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
